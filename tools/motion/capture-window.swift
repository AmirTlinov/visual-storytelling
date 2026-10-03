import AVFoundation
import AppKit
import CoreGraphics
import Foundation
import ScreenCaptureKit

@available(macOS 15.0, *)
final class RecordingDelegate: NSObject, SCRecordingOutputDelegate, @unchecked Sendable {
  private let lock = NSLock()
  private var finished = false
  private var failure: Error?
  func recordingOutputDidStartRecording(_ recordingOutput: SCRecordingOutput) {}
  func recordingOutputDidFinishRecording(_ recordingOutput: SCRecordingOutput) {
    lock.lock()
    finished = true
    lock.unlock()
  }
  func recordingOutput(_ recordingOutput: SCRecordingOutput, didFailWithError error: Error) {
    lock.lock()
    failure = error
    finished = true
    lock.unlock()
  }
  func status() -> (Bool, Error?) {
    lock.lock()
    defer { lock.unlock() }
    return (finished, failure)
  }
}

@main struct CaptureWindow {
  @MainActor static func main() async {
    do {
      NSApplication.shared.setActivationPolicy(.prohibited)
      guard #available(macOS 15.0, *) else {
        throw NSError(
          domain: "motion", code: 1,
          userInfo: [NSLocalizedDescriptionKey: "Window capture requires macOS 15 or later"])
      }
      if CommandLine.arguments.dropFirst().first == "status" {
        print(
          String(
            data: try JSONSerialization.data(
              withJSONObject: [
                "available": CGPreflightScreenCaptureAccess(),
                "permission": "macOS Screen Recording",
              ], options: [.sortedKeys]), encoding: .utf8)!)
        return
      }
      guard CGPreflightScreenCaptureAccess() else {
        throw NSError(
          domain: "motion", code: 2,
          userInfo: [
            NSLocalizedDescriptionKey:
              "Screen Recording permission is required for this terminal or Codex in macOS System Settings > Privacy & Security"
          ])
      }
      let content = try await SCShareableContent.excludingDesktopWindows(
        true, onScreenWindowsOnly: true)
      let windows = content.windows.filter {
        $0.windowLayer == 0 && $0.frame.width > 20 && $0.frame.height > 20
      }
      let args = Array(CommandLine.arguments.dropFirst())
      if args.first == "list" {
        let rows: [[String: Any]] = windows.map {
          [
            "id": $0.windowID, "app": $0.owningApplication?.applicationName ?? "",
            "title": $0.title ?? "", "width": $0.frame.width, "height": $0.frame.height,
          ]
        }
        print(
          String(
            data: try JSONSerialization.data(withJSONObject: rows, options: [.sortedKeys]),
            encoding: .utf8)!)
        return
      }
      guard args.count == 3, let id = UInt32(args[0]), let seconds = Double(args[1]),
        seconds >= 0.1, seconds <= 15,
        let window = windows.first(where: { $0.windowID == id })
      else {
        throw NSError(
          domain: "motion", code: 3,
          userInfo: [
            NSLocalizedDescriptionKey:
              "Choose an on-screen window ID from --windows and seconds between 0.1 and 15"
          ])
      }
      let output = URL(fileURLWithPath: args[2])
      guard !FileManager.default.fileExists(atPath: output.path) else {
        throw NSError(
          domain: "motion", code: 4,
          userInfo: [
            NSLocalizedDescriptionKey: "Recording path already exists; use a fresh output directory"
          ])
      }
      let filter = SCContentFilter(desktopIndependentWindow: window)
      let config = SCStreamConfiguration()
      let scale = Double(filter.pointPixelScale)
      config.width = Int(window.frame.width * scale) / 2 * 2
      config.height = Int(window.frame.height * scale) / 2 * 2
      config.minimumFrameInterval = CMTime(value: 1, timescale: 60)
      config.showsCursor = true
      config.capturesAudio = false
      config.queueDepth = 5
      let recordingConfig = SCRecordingOutputConfiguration()
      recordingConfig.outputURL = output
      recordingConfig.videoCodecType = .h264
      recordingConfig.outputFileType = .mp4
      let delegate = RecordingDelegate()
      let recording = SCRecordingOutput(configuration: recordingConfig, delegate: delegate)
      let stream = SCStream(filter: filter, configuration: config, delegate: nil)
      try stream.addRecordingOutput(recording)
      try await stream.startCapture()
      FileHandle.standardError.write(
        Data("Recording selected window for \(seconds) seconds\n".utf8))
      try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
      try await stream.stopCapture()
      for _ in 0..<200 {
        let state = delegate.status()
        if let failure = state.1 { throw failure }
        if state.0 { break }
        try await Task.sleep(nanoseconds: 50_000_000)
      }
      guard delegate.status().0 else {
        throw NSError(
          domain: "motion", code: 5,
          userInfo: [
            NSLocalizedDescriptionKey: "Recording did not finish writing within 10 seconds"
          ])
      }
      print(
        String(
          data: try JSONSerialization.data(
            withJSONObject: [
              "path": output.path, "windowID": id,
              "app": window.owningApplication?.applicationName ?? "", "width": config.width,
              "height": config.height,
            ], options: [.sortedKeys]), encoding: .utf8)!)
    } catch {
      FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
      exit(1)
    }
  }
}
