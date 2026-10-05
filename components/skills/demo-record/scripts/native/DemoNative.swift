// Native-app driver for the demo runner: records one macOS app window with
// ScreenCaptureKit and drives it through the Accessibility API and real input
// events. The runner talks to it with one JSON object per line on stdin
// ({"id": 1, "op": "attach", ...}) and reads one reply per line on stdout
// ({"id": 1, "ok": true, "result": ...}).
//
// Needs Screen Recording and Accessibility for the app that launched the runner
// (the terminal or agent host). Input is only ever sent while the target app is
// frontmost, and any mouse movement the helper did not make aborts the take, so
// a person touching the mouse cannot send clicks somewhere else.
import AppKit
import ApplicationServices
import CoreImage
import CoreMedia
import Foundation
import ScreenCaptureKit

struct HelperError: Error { let message: String }
func fail(_ message: String) -> HelperError { HelperError(message: message) }

let out = DispatchQueue(label: "demo-native.stdout")
func reply(_ id: Any?, result: Any? = nil, error: String? = nil) {
  var obj: [String: Any] = ["id": id ?? NSNull()]
  if let error { obj["ok"] = false; obj["error"] = error } else { obj["ok"] = true; obj["result"] = result ?? NSNull() }
  guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return }
  out.sync {
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
  }
}

// ---------- geometry ----------

// AX, CGEvent and ScreenCaptureKit use global coordinates with the origin at
// the top-left of the primary display; AppKit windows use bottom-left.
func primaryHeight() -> CGFloat { NSScreen.screens.first?.frame.height ?? 0 }
func toCocoa(_ r: CGRect) -> NSRect { NSRect(x: r.minX, y: primaryHeight() - r.maxY, width: r.width, height: r.height) }
func rectJSON(_ r: CGRect) -> [String: Double] {
  ["x": Double(r.minX), "y": Double(r.minY), "width": Double(r.width), "height": Double(r.height)]
}

// ---------- accessibility ----------

func attr(_ el: AXUIElement, _ name: String) -> AnyObject? {
  var value: AnyObject?
  return AXUIElementCopyAttributeValue(el, name as CFString, &value) == .success ? value : nil
}

func frameOf(_ el: AXUIElement) -> CGRect? {
  guard let p = attr(el, kAXPositionAttribute), let s = attr(el, kAXSizeAttribute) else { return nil }
  var point = CGPoint.zero
  var size = CGSize.zero
  AXValueGetValue(p as! AXValue, .cgPoint, &point)
  AXValueGetValue(s as! AXValue, .cgSize, &size)
  return CGRect(origin: point, size: size)
}

struct Query {
  let roles: [String]
  let subrole: String?
  let name: String?
  let exact: Bool
  let pattern: NSRegularExpression?
  let domId: String?
  let domClass: String?
  let index: Int

  init(_ json: [String: Any]) throws {
    roles = json["roles"] as? [String] ?? []
    subrole = json["subrole"] as? String
    name = json["name"] as? String
    exact = json["exact"] as? Bool ?? false
    if let p = json["pattern"] as? [String: String], let source = p["source"] {
      let flags = p["flags"] ?? ""
      pattern = try NSRegularExpression(pattern: source, options: flags.contains("i") ? [.caseInsensitive] : [])
    } else {
      pattern = nil
    }
    domId = json["id"] as? String
    domClass = json["className"] as? String
    index = json["index"] as? Int ?? 0
    if roles.isEmpty && subrole == nil && name == nil && pattern == nil && domId == nil && domClass == nil {
      throw fail("a target needs at least one of role, subrole, name, id or className")
    }
  }

  var label: String {
    var parts: [String] = []
    if !roles.isEmpty { parts.append(roles.joined(separator: "|")) }
    if let name { parts.append("\"\(name)\"") }
    if let pattern { parts.append("/\(pattern.pattern)/") }
    if let domId { parts.append("#\(domId)") }
    if let domClass { parts.append(".\(domClass)") }
    if index > 0 { parts.append("[\(index)]") }
    return parts.joined(separator: " ")
  }
}

let ATTRS = [kAXRoleAttribute, kAXSubroleAttribute, kAXTitleAttribute, kAXDescriptionAttribute,
             kAXValueAttribute, kAXPlaceholderValueAttribute, "AXDOMIdentifier", "AXDOMClassList",
             kAXChildrenAttribute] as [CFString]

struct Node {
  let el: AXUIElement
  let role: String
  let subrole: String
  let names: [String]
  let domId: String
  let domClasses: [String]
  let children: [AXUIElement]
}

func readNode(_ el: AXUIElement) -> Node {
  var values: CFArray?
  AXUIElementCopyMultipleAttributeValues(el, ATTRS as CFArray, AXCopyMultipleAttributeOptions(rawValue: 0), &values)
  let v = (values as? [AnyObject]) ?? []
  func s(_ i: Int) -> String? { i < v.count ? v[i] as? String : nil }
  let names = [s(2), s(3), s(4), s(5)].compactMap { $0 }.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
  let classes = (v.count > 7 ? v[7] as? [String] : nil) ?? []
  let kids = (v.count > 8 ? v[8] as? [AXUIElement] : nil) ?? []
  return Node(el: el, role: s(0) ?? "", subrole: s(1) ?? "", names: names, domId: s(6) ?? "", domClasses: classes, children: kids)
}

func matches(_ n: Node, _ q: Query) -> Bool {
  if !q.roles.isEmpty && !q.roles.contains(n.role) { return false }
  if let sub = q.subrole, n.subrole != sub { return false }
  if let id = q.domId, n.domId != id { return false }
  if let cls = q.domClass, !n.domClasses.contains(cls) { return false }
  if let name = q.name {
    let hit = n.names.contains { q.exact ? $0 == name : $0.range(of: name, options: .caseInsensitive) != nil }
    if !hit { return false }
  }
  if let p = q.pattern {
    let hit = n.names.contains { p.firstMatch(in: $0, range: NSRange($0.startIndex..., in: $0)) != nil }
    if !hit { return false }
  }
  return true
}

// ---------- overlay: highlights and click ripples, drawn above the app ----------

final class OverlayView: NSView {
  var highlights: [(rect: CGRect, until: Date)] = []
  var ripples: [(point: CGPoint, at: Date)] = []
  var origin = CGPoint.zero  // the overlay window's top-left, global coordinates

  override var isFlipped: Bool { true }

  override func draw(_ dirtyRect: NSRect) {
    let now = Date()
    highlights.removeAll { $0.until < now }
    ripples.removeAll { now.timeIntervalSince($0.at) > 0.45 }
    for h in highlights {
      let r = h.rect.offsetBy(dx: -origin.x, dy: -origin.y).insetBy(dx: -6, dy: -6)
      let path = NSBezierPath(roundedRect: r, xRadius: 8, yRadius: 8)
      path.lineWidth = 4
      NSColor(calibratedRed: 1, green: 0.77, blue: 0, alpha: 0.95).setStroke()
      path.stroke()
    }
    for rp in ripples {
      let age = CGFloat(now.timeIntervalSince(rp.at) / 0.45)
      let radius = 10 + 18 * age
      let p = CGPoint(x: rp.point.x - origin.x, y: rp.point.y - origin.y)
      let circle = NSBezierPath(ovalIn: CGRect(x: p.x - radius, y: p.y - radius, width: radius * 2, height: radius * 2))
      NSColor(calibratedRed: 1, green: 0.77, blue: 0, alpha: 0.55 * (1 - age)).setFill()
      circle.fill()
    }
  }
}

final class Overlay {
  let window: NSWindow
  let view = OverlayView()
  var timer: Timer?

  init() {
    window = NSWindow(contentRect: .zero, styleMask: .borderless, backing: .buffered, defer: false)
    window.isOpaque = false
    window.backgroundColor = .clear
    window.hasShadow = false
    window.ignoresMouseEvents = true
    window.level = .floating
    window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
    window.contentView = view
  }

  func cover(_ frame: CGRect) {
    view.origin = frame.origin
    window.setFrame(toCocoa(frame), display: true)
    window.orderFrontRegardless()
    timer?.invalidate()
    timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60, repeats: true) { [weak self] _ in self?.view.needsDisplay = true }
  }

  func close() {
    timer?.invalidate()
    window.orderOut(nil)
  }
}

// ---------- capture ----------

final class Capture: NSObject, SCStreamOutput, SCStreamDelegate {
  let dir: URL
  let index: FileHandle
  let queue = DispatchQueue(label: "demo-native.capture")
  let context = CIContext()
  var stream: SCStream?
  var count = 0
  var lastFile: String?
  var stopError: String?

  init(dir: URL) throws {
    self.dir = dir
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let indexURL = dir.appendingPathComponent("frames.jsonl")
    FileManager.default.createFile(atPath: indexURL.path, contents: nil)
    index = try FileHandle(forWritingTo: indexURL)
  }

  // Captures the screen region the window occupies rather than the window
  // alone: open/save panels and the highlight overlay belong to other
  // processes, and a window-only capture would leave them out of the video.
  func start(region: CGRect, width: Int, height: Int, fps: Int) async throws {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    let centre = CGPoint(x: region.midX, y: region.midY)
    guard let display = content.displays.first(where: { $0.frame.contains(centre) }) ?? content.displays.first else {
      throw fail("no display to capture")
    }
    let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
    let config = SCStreamConfiguration()
    config.sourceRect = region.offsetBy(dx: -display.frame.minX, dy: -display.frame.minY)
    config.width = width
    config.height = height
    config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
    config.showsCursor = true
    config.pixelFormat = kCVPixelFormatType_32BGRA
    config.queueDepth = 8
    let stream = SCStream(filter: filter, configuration: config, delegate: self)
    try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
    try await stream.startCapture()
    self.stream = stream
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .screen, buffer.isValid,
          let infos = CMSampleBufferGetSampleAttachmentsArray(buffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
          let raw = infos.first?[.status] as? Int, SCFrameStatus(rawValue: raw) == .complete,
          let pixels = buffer.imageBuffer else { return }
    let t = Date().timeIntervalSince1970
    let image = CIImage(cvPixelBuffer: pixels)
    guard let space = CGColorSpace(name: CGColorSpace.sRGB),
          let jpeg = context.jpegRepresentation(of: image, colorSpace: space,
                                                options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.92])
    else { return }
    let file = dir.appendingPathComponent(String(format: "%06d.jpg", count)).path
    count += 1
    guard FileManager.default.createFile(atPath: file, contents: jpeg) else { return }
    lastFile = file
    if let line = try? JSONSerialization.data(withJSONObject: ["file": file, "t": t]) {
      index.write(line)
      index.write(Data([0x0A]))
    }
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    stopError = error.localizedDescription
  }

  func stop() async {
    try? await stream?.stopCapture()
    queue.sync {}
    try? index.close()
  }
}

// ---------- the driver ----------

final class Driver {
  var app: NSRunningApplication?
  var axApp: AXUIElement?
  var windowFrame = CGRect.zero
  var lastPointer: CGPoint?
  var capture: Capture?
  let overlay: Overlay

  init(overlay: Overlay) { self.overlay = overlay }

  func handle(_ op: String, _ args: [String: Any]) throws -> Any? {
    switch op {
    case "preflight":
      if args["prompt"] as? Bool == true {
        _ = CGRequestScreenCaptureAccess()
        _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
      }
      return ["screenRecording": CGPreflightScreenCaptureAccess(), "accessibility": AXIsProcessTrusted()]
    case "running":
      let name = args["app"] as? String ?? ""
      return NSWorkspace.shared.runningApplications.contains { $0.bundleIdentifier == name || $0.localizedName == name }
    case "attach": return try attach(args)
    case "capture": return try startCapture(args)
    case "stop": return stopCapture()
    case "front": try ensureFront(); return nil
    case "find": return rectJSON(try locate(args))
    case "exists": return (try? find(try Query(args["target"] as? [String: Any] ?? [:]))) != nil
    case "text": return try readText(args)
    case "scrollIntoView": return rectJSON(try scrollIntoView(args))
    case "move":
      let p = try point(args)
      try move(to: p, duration: args["duration"] as? Double ?? 0.6)
      return nil
    case "click":
      let p = try point(args)
      try move(to: p, duration: args["duration"] as? Double ?? 0.6)
      usleep(150_000)
      try click(at: p, count: args["count"] as? Int ?? 1)
      return nil
    case "textBounds": return rectJSON(try textBounds(args))
    case "stroke":
      guard let raw = args["points"] as? [[Double]], raw.count >= 2, raw.allSatisfy({ $0.count == 2 }) else {
        throw fail("stroke needs at least two [x, y] points")
      }
      try stroke(raw.map { CGPoint(x: $0[0], y: $0[1]) }, duration: args["duration"] as? Double ?? 0.8)
      return nil
    case "drag":
      guard let from = args["from"] as? [Double], let to = args["to"] as? [Double], from.count == 2, to.count == 2 else {
        throw fail("drag needs from: [x, y] and to: [x, y]")
      }
      try drag(from: CGPoint(x: from[0], y: from[1]), to: CGPoint(x: to[0], y: to[1]), duration: args["duration"] as? Double ?? 0.6)
      return nil
    case "type": try type(args["text"] as? String ?? "", delay: args["delay"] as? Double ?? 0.055); return nil
    case "key": try key(args["key"] as? String ?? ""); return nil
    case "paste": try paste(args["text"] as? String ?? ""); return nil
    case "scroll": try scroll(args["pixels"] as? Double ?? 0); return nil
    case "highlight":
      let r: CGRect
      if let rect = args["rect"] as? [String: Double], let x = rect["x"], let y = rect["y"], let w = rect["width"], let h = rect["height"] {
        r = CGRect(x: x, y: y, width: w, height: h)
      } else {
        r = try locate(args)
      }
      let seconds = args["seconds"] as? Double ?? 1.5
      DispatchQueue.main.async { self.overlay.view.highlights.append((r, Date().addingTimeInterval(seconds))) }
      return nil
    case "quit":
      overlay.close()
      exit(0)
    default:
      throw fail("unknown op '\(op)'")
    }
  }

  // Finds the app by bundle id or name, launching it from `path` if needed,
  // then sizes and centres its main window.
  func attach(_ args: [String: Any]) throws -> Any? {
    let name = args["app"] as? String ?? ""
    let running = { NSWorkspace.shared.runningApplications.first { $0.bundleIdentifier == name || $0.localizedName == name } }
    if running() == nil, let path = args["path"] as? String {
      let done = DispatchSemaphore(value: 0)
      NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: path), configuration: NSWorkspace.OpenConfiguration()) { _, _ in done.signal() }
      _ = done.wait(timeout: .now() + 30)
    }
    var found: NSRunningApplication?
    for _ in 0..<120 { if let a = running() { found = a; break }; usleep(250_000) }
    guard let target = found else { throw fail("'\(name)' is not running and no launch path was given") }
    app = target
    axApp = AXUIElementCreateApplication(target.processIdentifier)
    var window: AXUIElement?
    for _ in 0..<120 {
      if let w = attr(axApp!, kAXMainWindowAttribute) { window = (w as! AXUIElement); break }
      if let ws = attr(axApp!, kAXWindowsAttribute) as? [AXUIElement], let w = ws.first { window = w; break }
      usleep(250_000)
    }
    guard let window else { throw fail("'\(name)' has no window (is Accessibility granted?)") }
    let width = args["width"] as? Double ?? 1440
    let height = args["height"] as? Double ?? 810
    let screen = NSScreen.screens.first!.visibleFrame
    let top = primaryHeight() - screen.maxY
    var origin = CGPoint(x: screen.minX + max(0, (screen.width - width) / 2), y: top + max(0, (screen.height - height) / 2))
    var size = CGSize(width: width, height: height)
    // Size first: a large window cannot move to the centred origin without
    // running off the screen, so the system would clamp the position.
    AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, AXValueCreate(.cgSize, &size)!)
    AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, AXValueCreate(.cgPoint, &origin)!)
    AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, AXValueCreate(.cgSize, &size)!)
    AXUIElementSetAttributeValue(window, kAXMainAttribute as CFString, kCFBooleanTrue)
    usleep(300_000)
    windowFrame = frameOf(window) ?? CGRect(origin: origin, size: size)
    try ensureFront()
    let frame = windowFrame
    DispatchQueue.main.sync { overlay.cover(frame) }
    return rectJSON(windowFrame)
  }

  func startCapture(_ args: [String: Any]) throws -> Any? {
    guard windowFrame != .zero else { throw fail("attach before capture") }
    let dir = URL(fileURLWithPath: args["dir"] as? String ?? "frames")
    let c = try Capture(dir: dir)
    let done = DispatchSemaphore(value: 0)
    var error: Error?
    let region = windowFrame
    Task {
      do { try await c.start(region: region, width: args["width"] as? Int ?? 1920, height: args["height"] as? Int ?? 1080, fps: args["fps"] as? Int ?? 30) }
      catch let e { error = e }
      done.signal()
    }
    done.wait()
    if let error { throw fail("screen capture did not start: \(error.localizedDescription) (is Screen Recording granted?)") }
    capture = c
    return ["index": dir.appendingPathComponent("frames.jsonl").path]
  }

  func stopCapture() -> Any? {
    guard let c = capture else { return ["frames": 0] }
    let done = DispatchSemaphore(value: 0)
    Task { await c.stop(); done.signal() }
    done.wait()
    capture = nil
    return ["frames": c.count, "lastFile": (c.lastFile as Any?) ?? NSNull(), "error": (c.stopError as Any?) ?? NSNull()] as [String: Any]
  }

  // ----- element lookup -----

  func roots() throws -> [AXUIElement] {
    guard let axApp else { throw fail("attach first") }
    return (attr(axApp, kAXWindowsAttribute) as? [AXUIElement]) ?? []
  }

  func find(_ q: Query) throws -> AXUIElement {
    var queue = try roots()
    var seen = 0
    var hits = 0
    while !queue.isEmpty && seen < 40000 {
      let el = queue.removeFirst()
      seen += 1
      let n = readNode(el)
      if matches(n, q) {
        if hits == q.index { return el }
        hits += 1
      }
      queue.append(contentsOf: n.children)
    }
    throw fail("no element matches \(q.label)")
  }

  func waitFind(_ args: [String: Any]) throws -> AXUIElement {
    let q = try Query(args["target"] as? [String: Any] ?? [:])
    let deadline = Date().addingTimeInterval(args["timeout"] as? Double ?? 20)
    while true {
      do { return try find(q) } catch let e as HelperError {
        if Date() > deadline { throw fail("\(e.message) after \(Int(args["timeout"] as? Double ?? 20))s") }
        usleep(200_000)
      }
    }
  }

  // Like waitFind, but also waits for the element to be laid out: right after
  // a navigation an element can exist before it has a size.
  func waitLaidOut(_ args: [String: Any]) throws -> AXUIElement {
    let deadline = Date().addingTimeInterval(args["timeout"] as? Double ?? 20)
    while true {
      let el = try waitFind(args)
      if let r = frameOf(el), r.width > 0, r.height > 0 { return el }
      if Date() > deadline { throw fail("element has no on-screen frame") }
      usleep(200_000)
    }
  }

  func locate(_ args: [String: Any]) throws -> CGRect {
    try retryingStale(args) { el in
      guard let r = frameOf(el) else { throw fail("element has no on-screen frame") }
      return r
    }
  }

  // Whether a point actually lands on the element: true when the element under
  // it is the element or one of its descendants. Being inside the window is not
  // enough, because a scrolled pane clips what it holds.
  func hits(_ el: AXUIElement, at p: CGPoint) -> Bool {
    guard let axApp, windowFrame.contains(p) else { return false }
    var found: AXUIElement?
    guard AXUIElementCopyElementAtPosition(axApp, Float(p.x), Float(p.y), &found) == .success, var node = found else { return false }
    // A label-wrapped control reports the label's box as its own, and the
    // label is what sits under the point: the same box counts as a hit.
    let own = frameOf(el)
    for _ in 0..<8 {
      if CFEqual(node, el) { return true }
      if let own, let other = frameOf(node), abs(own.minX - other.minX) < 1, abs(own.minY - other.minY) < 1,
         abs(own.width - other.width) < 1, abs(own.height - other.height) < 1 { return true }
      guard let parent = attr(node, kAXParentAttribute) else { return false }
      node = parent as! AXUIElement
    }
    return false
  }

  // Scrolls until `probe` (the element's centre, or a phrase in it) is really
  // visible, using the element's own AXScrollToVisible, which reaches nested
  // scrolling panes.
  //
  // AXScrollToVisible aligns the element with the scroller's edge, which can
  // leave it under a sticky header; then the pointer moves to the window's side
  // margin and the page itself is scrolled toward the window's middle, so an
  // inner pane under the pointer is not scrolled instead.
  func reveal(_ el: AXUIElement, probe: () throws -> CGPoint) throws {
    if hits(el, at: try probe()) { return }
    AXUIElementPerformAction(el, "AXScrollToVisible" as CFString)
    usleep(450_000)
    for _ in 0..<6 {
      let p = try probe()
      if hits(el, at: p) { return }
      let delta = p.y - windowFrame.midY
      let margin = CGPoint(x: windowFrame.minX + 24, y: windowFrame.midY)
      // A scroll event placed at a point moves the real cursor there, so glide
      // there first, as a person would; otherwise the pointer guard sees a move
      // it did not make, and the video shows the cursor jump.
      try move(to: margin, duration: 0.35)
      let ticks = max(1, min(30, Int(abs(delta) / 40)))
      for _ in 0..<ticks {
        let e = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: Int32(delta > 0 ? -40 : 40), wheel2: 0, wheel3: 0)
        e?.location = margin
        e?.post(tap: .cghidEventTap)
        usleep(12_000)
      }
      usleep(350_000)
    }
    if hits(el, at: try probe()) { return }
    throw fail("element is hidden or clipped by a scrolled pane, even after scrolling to it")
  }

  // Re-runs `body` with a freshly found element while the page replaces the
  // one it was holding (a re-render after load leaves a stale element with no
  // frame), until the action's timeout.
  func retryingStale<T>(_ args: [String: Any], _ body: (AXUIElement) throws -> T) throws -> T {
    let deadline = Date().addingTimeInterval(args["timeout"] as? Double ?? 20)
    while true {
      let el = try waitLaidOut(args)
      do { return try body(el) } catch let e as HelperError where e.message.contains("no on-screen frame") {
        if Date() > deadline { throw e }
        usleep(250_000)
      }
    }
  }

  func scrollIntoView(_ args: [String: Any]) throws -> CGRect {
    try retryingStale(args) { el in
      try reveal(el) {
        guard let r = frameOf(el) else { throw fail("element has no on-screen frame") }
        return CGPoint(x: r.midX, y: r.midY)
      }
      guard let r = frameOf(el) else { throw fail("element has no on-screen frame") }
      return r
    }
  }

  // Where a substring of an element's text is drawn, so it can be selected
  // with a real drag (a web page reads a mouse selection, not an AX one).
  func textBounds(_ args: [String: Any]) throws -> CGRect {
    try retryingStale(args) { el in
      try reveal(el) { let r = try bounds(of: el, args); return CGPoint(x: r.midX, y: r.midY) }
      return try bounds(of: el, args)
    }
  }

  func bounds(of el: AXUIElement, _ args: [String: Any]) throws -> CGRect {
    guard let needle = args["text"] as? String, let value = attr(el, kAXValueAttribute) as? String else {
      throw fail("textBounds needs text, and an element with a text value")
    }
    let found = (value as NSString).range(of: needle)
    guard found.location != NSNotFound else { throw fail("'\(needle)' is not in the element's text") }
    var range = CFRange(location: found.location, length: found.length)
    var bounds: AnyObject?
    guard AXUIElementCopyParameterizedAttributeValue(el, kAXBoundsForRangeParameterizedAttribute as CFString,
                                                     AXValueCreate(.cfRange, &range)!, &bounds) == .success,
          let raw = bounds else { throw fail("the element cannot report bounds for its text") }
    var rect = CGRect.zero
    AXValueGetValue(raw as! AXValue, .cgRect, &rect)
    return rect
  }

  func readText(_ args: [String: Any]) throws -> Any? {
    let n = readNode(try waitFind(args))
    return ["role": n.role, "names": n.names]
  }

  func point(_ args: [String: Any]) throws -> CGPoint {
    if let x = args["x"] as? Double, let y = args["y"] as? Double { return CGPoint(x: x, y: y) }
    let r = try scrollIntoView(args)
    return CGPoint(x: r.midX, y: r.midY)
  }

  // ----- input -----

  // The focused app. Accessibility answers live but intermittently fails to
  // answer at all; NSWorkspace always answers but is refreshed on the main run
  // loop, so it can lag an activation. Prefer the first, fall back to the second.
  //
  // The focused element is asked first: a non-activating panel (Spotlight, a
  // launcher, a dictation overlay) takes the keyboard without changing the
  // frontmost app, so only the element's owner shows where keys would land.
  func frontPid() -> pid_t? {
    let system = AXUIElementCreateSystemWide()
    for name in [kAXFocusedUIElementAttribute, kAXFocusedApplicationAttribute] {
      if let focused = attr(system, name) {
        var pid: pid_t = 0
        if AXUIElementGetPid(focused as! AXUIElement, &pid) == .success { return pid }
      }
    }
    return NSWorkspace.shared.frontmostApplication?.processIdentifier
  }

  func screenLocked() -> Bool {
    NSWorkspace.shared.frontmostApplication?.bundleIdentifier == "com.apple.loginwindow"
  }

  func ensureFront() throws {
    guard let app else { throw fail("attach first") }
    if frontPid() == app.processIdentifier { return }
    if screenLocked() { throw fail("the screen is locked; unlock the Mac and keep it awake (caffeinate) for the take") }
    app.activate()
    for attempt in 0..<30 {
      usleep(100_000)
      if frontPid() == app.processIdentifier { return }
      // macOS treats a background process's activate() as a request it may
      // decline while someone works in another app; LaunchServices is honoured.
      if attempt == 8, let url = app.bundleURL {
        let config = NSWorkspace.OpenConfiguration()
        config.activates = true
        NSWorkspace.shared.openApplication(at: url, configuration: config) { _, _ in }
      }
    }
    throw fail("\(app.localizedName ?? "the app") is not frontmost; refusing to send input to another app")
  }

  // Checked before every individual event, not once per action: a long type
  // or glide gives someone time to click into another app part-way through.
  func stillFront() throws {
    guard let app else { throw fail("attach first") }
    // A focus change has to last 300ms to count, so a momentary blip in
    // either source does not end a take; a real switch away still does.
    for _ in 0..<6 {
      if frontPid() == app.processIdentifier { return }
      usleep(50_000)
    }
    throw fail("\(app.localizedName ?? "the app") stopped being frontmost mid-action; stopping so no input goes astray")
  }

  func guardPointer() throws {
    guard let last = lastPointer, var now = CGEvent(source: nil)?.location else { return }
    // The system cursor can lag the last posted event by a frame on a fast
    // glide, so give it a moment to arrive before calling it someone else's move.
    for _ in 0..<5 where hypot(now.x - last.x, now.y - last.y) > 4 {
      usleep(20_000)
      now = CGEvent(source: nil)?.location ?? now
    }
    if hypot(now.x - last.x, now.y - last.y) > 4 {
      throw fail("the mouse moved during the take (someone touched it?); stopping so no input goes astray")
    }
  }

  func move(to p: CGPoint, duration: Double) throws {
    try ensureFront()
    try guardPointer()
    let start = lastPointer ?? CGEvent(source: nil)?.location ?? p
    let steps = max(1, Int(duration * 60))
    for i in 1...steps {
      try stillFront()
      try guardPointer()
      let t = Double(i) / Double(steps)
      let e = t < 0.5 ? 2 * t * t : 1 - pow(-2 * t + 2, 2) / 2
      let q = CGPoint(x: start.x + (p.x - start.x) * e, y: start.y + (p.y - start.y) * e)
      CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: q, mouseButton: .left)?.post(tap: .cghidEventTap)
      lastPointer = q
      usleep(useconds_t(duration / Double(steps) * 1_000_000))
    }
  }

  func click(at p: CGPoint, count: Int) throws {
    try ensureFront()
    try guardPointer()
    DispatchQueue.main.async { self.overlay.view.ripples.append((p, Date())) }
    for n in 1...max(1, count) {
      try stillFront()
      for type in [CGEventType.leftMouseDown, .leftMouseUp] {
        let e = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: p, mouseButton: .left)
        e?.setIntegerValueField(.mouseEventClickState, value: Int64(n))
        e?.post(tap: .cghidEventTap)
        usleep(40_000)
      }
    }
    lastPointer = p
  }

  func type(_ text: String, delay: Double) throws {
    try ensureFront()
    for ch in text {
      try stillFront()
      if ch == "\n" { try key("Enter"); usleep(useconds_t(delay * 1_000_000)); continue }
      let units = Array(String(ch).utf16)
      for down in [true, false] {
        let e = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down)
        e?.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
        e?.post(tap: .cghidEventTap)
      }
      usleep(useconds_t(delay * 1_000_000))
    }
  }

  static let keyCodes: [String: CGKeyCode] = [
    "enter": 36, "return": 36, "tab": 48, "space": 49, "backspace": 51, "delete": 117, "escape": 53, "esc": 53,
    "left": 123, "right": 124, "down": 125, "up": 126, "home": 115, "end": 119, "pageup": 116, "pagedown": 121,
    "a": 0, "b": 11, "c": 8, "d": 2, "e": 14, "f": 3, "g": 5, "h": 4, "i": 34, "j": 38, "k": 40, "l": 37, "m": 46,
    "n": 45, "o": 31, "p": 35, "q": 12, "r": 15, "s": 1, "t": 17, "u": 32, "v": 9, "w": 13, "x": 7, "y": 16, "z": 6,
    "0": 29, "1": 18, "2": 19, "3": 20, "4": 21, "5": 23, "6": 22, "7": 26, "8": 28, "9": 25, "/": 44, ".": 47, ",": 43,
  ]

  // One continuous pen stroke through `points`: press at the first, drag through
  // the rest at an even pace, release at the last. For signature pads and canvases.
  func stroke(_ points: [CGPoint], duration: Double) throws {
    try move(to: points[0], duration: 0.4)
    try stillFront()
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: points[0], mouseButton: .left)?.post(tap: .cghidEventTap)
    let pause = useconds_t(duration / Double(points.count - 1) * 1_000_000)
    for p in points.dropFirst() {
      try stillFront()
      CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
      lastPointer = p
      usleep(pause)
    }
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: points.last!, mouseButton: .left)?.post(tap: .cghidEventTap)
    lastPointer = points.last!
  }

  func drag(from: CGPoint, to: CGPoint, duration: Double) throws {
    try move(to: from, duration: 0.5)
    try stillFront()
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: from, mouseButton: .left)?.post(tap: .cghidEventTap)
    let steps = max(2, Int(duration * 60))
    for i in 1...steps {
      try stillFront()
      let t = Double(i) / Double(steps)
      let q = CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t)
      CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: q, mouseButton: .left)?.post(tap: .cghidEventTap)
      lastPointer = q
      usleep(useconds_t(duration / Double(steps) * 1_000_000))
    }
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: to, mouseButton: .left)?.post(tap: .cghidEventTap)
    lastPointer = to
  }

  // "Enter", "Escape", "Cmd+Shift+G", "Ctrl+Alt+D".
  func key(_ combo: String) throws {
    try ensureFront()
    var flags = CGEventFlags()
    var code: CGKeyCode?
    for part in combo.split(separator: "+").map({ $0.trimmingCharacters(in: .whitespaces).lowercased() }) {
      switch part {
      case "cmd", "command", "meta": flags.insert(.maskCommand)
      case "shift": flags.insert(.maskShift)
      case "alt", "option", "opt": flags.insert(.maskAlternate)
      case "ctrl", "control": flags.insert(.maskControl)
      default:
        guard let c = Driver.keyCodes[part] else { throw fail("unknown key '\(part)' in '\(combo)'") }
        code = c
      }
    }
    guard let code else { throw fail("no key in '\(combo)'") }
    // Press the modifier keys themselves, not just flags on the key event:
    // open and save panels run in a separate service that reads the real
    // modifier state and ignores a flagged-only Cmd+Shift+G.
    let mods: [(CGEventFlags, CGKeyCode)] = [(.maskCommand, 55), (.maskShift, 56), (.maskAlternate, 58), (.maskControl, 59)]
      .filter { flags.contains($0.0) }
    let source = CGEventSource(stateID: .hidSystemState)
    var held = CGEventFlags()
    for (flag, key) in mods {
      held.insert(flag)
      let e = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: true)
      e?.flags = held
      e?.post(tap: .cghidEventTap)
      usleep(20_000)
    }
    for down in [true, false] {
      let e = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down)
      e?.flags = flags
      e?.post(tap: .cghidEventTap)
      usleep(30_000)
    }
    for (flag, key) in mods.reversed() {
      held.remove(flag)
      let e = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: false)
      e?.flags = held
      e?.post(tap: .cghidEventTap)
      usleep(20_000)
    }
  }

  // Pastes through the clipboard and puts the previous text contents back.
  func paste(_ text: String) throws {
    let board = NSPasteboard.general
    let previous = board.string(forType: .string)
    board.clearContents()
    board.setString(text, forType: .string)
    try key("Cmd+V")
    usleep(350_000)
    board.clearContents()
    if let previous { board.setString(previous, forType: .string) }
  }

  func scroll(_ pixels: Double) throws {
    try ensureFront()
    try guardPointer()
    let steps = max(1, Int(abs(pixels) / 40))
    for _ in 0..<steps {
      try stillFront()
      try guardPointer()
      let e = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: Int32(pixels > 0 ? -40 : 40), wheel2: 0, wheel3: 0)
      e?.post(tap: .cghidEventTap)
      usleep(16_000)
    }
  }
}

// ---------- main ----------

NSApplication.shared.setActivationPolicy(.accessory)
let driver = Driver(overlay: Overlay())  // top-level code runs on the main thread
Thread {
  while let line = readLine() {
    guard let data = line.data(using: .utf8),
          let msg = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
    let id = msg["id"]
    do {
      reply(id, result: try driver.handle(msg["op"] as? String ?? "", msg))
    } catch let e as HelperError {
      reply(id, error: e.message)
    } catch {
      reply(id, error: error.localizedDescription)
    }
  }
  DispatchQueue.main.async { driver.overlay.close(); exit(0) }
}.start()
NSApplication.shared.run()
