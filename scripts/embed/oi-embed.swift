// On-device sentence embeddings for the local semantic reader. macOS only (Apple NaturalLanguage); free, offline, nothing leaves the machine.
// stdin: one JSON object per line {"id": "...", "subject": "...", "body": "..."}; stdout: one JSON object per line {"id": "...", "vec": [512 numbers]}.
import Foundation
import NaturalLanguage

guard let emb = NLEmbedding.sentenceEmbedding(for: .english) else {
    FileHandle.standardError.write("no on-device sentence embedding available\n".data(using: .utf8)!)
    exit(2)
}
let dim = emb.dimension
let tokenizer = NLTokenizer(unit: .sentence)

func sentences(_ text: String, limit: Int) -> [String] {
    tokenizer.string = text
    var out: [String] = []
    tokenizer.enumerateTokens(in: text.startIndex..<text.endIndex) { range, _ in
        let s = String(text[range]).trimmingCharacters(in: .whitespacesAndNewlines)
        if s.count > 12 { out.append(String(s.prefix(300))) }
        return out.count < limit
    }
    return out
}

func vector(_ s: String) -> [Double]? { emb.vector(for: s) }

while let line = readLine() {
    guard let data = line.data(using: .utf8), let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let id = obj["id"] as? String else { continue }
    let subject = (obj["subject"] as? String) ?? ""
    let body = (obj["body"] as? String) ?? ""
    var acc = [Double](repeating: 0, count: dim)
    var weight = 0.0
    func add(_ v: [Double]?, _ w: Double) { guard let v = v else { return }; for i in 0..<dim { acc[i] += v[i] * w }; weight += w }
    if !subject.isEmpty { add(vector(String(subject.prefix(200))), 2.0) }
    for s in sentences(String(body.prefix(2500)), limit: 6) { add(vector(s), 1.0) }
    if weight > 0 { for i in 0..<dim { acc[i] /= weight } }
    let out: [String: Any] = ["id": id, "vec": acc.map { (($0 * 1e5).rounded()) / 1e5 }]
    if let d = try? JSONSerialization.data(withJSONObject: out), let s = String(data: d, encoding: .utf8) { print(s) }
}
