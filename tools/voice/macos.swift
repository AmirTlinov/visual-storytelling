import Foundation
import AVFoundation

// The release bundles this executable, not a compiler or a voice model.
func emit(_ value: Any) {
    do { FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: value)); print("") }
    catch { fail(error.localizedDescription) }
}
func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data(message.utf8)); exit(1)
}
let voices = AVSpeechSynthesisVoice.speechVoices()
if CommandLine.arguments.contains("--voices") {
    emit(voices.map { ["id": $0.identifier, "name": $0.name, "language": $0.language, "quality": $0.quality.rawValue] as [String: Any] })
    exit(0)
}
let input: [String: Any]
do {
    guard let object = try JSONSerialization.jsonObject(with: FileHandle.standardInput.readDataToEndOfFile()) as? [String: Any]
        else { fail("Expected a synthesis request object.") }
    input = object
}
catch { fail("Invalid synthesis request: \(error)") }
guard let text = input["text"] as? String, !text.isEmpty,
      let output = input["output"] as? String,
      let voiceID = input["voice"] as? String,
      let voice = voices.first(where: { $0.identifier == voiceID }) else { fail("The selected macOS voice is unavailable.") }
let utterance = AVSpeechUtterance(string: text)
utterance.voice = voice
utterance.rate = Float(input["rate"] as? Double ?? Double(AVSpeechUtteranceDefaultSpeechRate))
let synth = AVSpeechSynthesizer()
var audio = Data(), markers = [[String: Any]](), sampleRate = 0.0, channels = 0
var audioFinished = false, utteranceFinished = false
var audioPartOffset = 0
let lock = NSLock()
final class Completion: NSObject, AVSpeechSynthesizerDelegate {
    let finished: () -> Void
    init(_ finished: @escaping () -> Void) { self.finished = finished }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) { finished() }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) { fail("Speech synthesis was cancelled.") }
}
let completion = Completion { lock.withLock { utteranceFinished = true } }
synth.delegate = completion
synth.write(utterance, toBufferCallback: { buffer in
    guard let pcm = buffer as? AVAudioPCMBuffer else { return }
    lock.lock(); defer { lock.unlock() }
    // A voice may finish several internal chunks before the utterance finishes.
    if pcm.frameLength == 0 { audioFinished = true; audioPartOffset = audio.count; return }
    audioFinished = false
    guard pcm.format.commonFormat == .pcmFormatFloat32,
          pcm.format.channelCount == 1, let samples = pcm.floatChannelData?[0] else {
        fail("The voice returned an unsupported audio format.")
    }
    sampleRate = pcm.format.sampleRate; channels = Int(pcm.format.channelCount)
    audio.append(UnsafeBufferPointer(start: samples, count: Int(pcm.frameLength)))
}, toMarkerCallback: { values in
    lock.lock(); defer { lock.unlock() }
    for marker in values where marker.mark == .word {
        let range = marker.textRange
        guard range.location + range.length <= (text as NSString).length else { continue }
        markers.append(["text": (text as NSString).substring(with: range), "offset": audioPartOffset + marker.byteSampleOffset,
            "location": range.location, "length": range.length])
    }
})
let deadline = Date().addingTimeInterval(180)
// Empty PCM buffers end chunks; the delegate owns completion of the full utterance.
while !lock.withLock({ audioFinished && utteranceFinished }) && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.01)) }
let result = lock.withLock { (finished: audioFinished && utteranceFinished, audio: audio, markers: markers, sampleRate: sampleRate, channels: channels) }
guard result.finished, !result.audio.isEmpty, !result.markers.isEmpty else { fail("The voice did not return audio with word markers.") }
do { try result.audio.write(to: URL(fileURLWithPath: output), options: .atomic) }
catch { fail("Could not write speech: \(error)") }
emit(["sampleRate": result.sampleRate, "channels": result.channels, "bytesPerSample": 4,
      "frames": result.audio.count / 4, "markers": result.markers, "voice": voiceID])
