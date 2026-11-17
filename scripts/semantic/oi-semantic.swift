// On-device semantic reader using Apple's system language model (FoundationModels, macOS 26 with Apple Intelligence). Free, offline, private:
// the model runs on this machine and nothing is sent anywhere.
// usage:  oi-semantic <guide.md>   stdin: one JSON ReaderInput per line   stdout: one JSON line per input, in the guide's output format
// A message the model cannot answer (guardrails, context limit, unparseable reply, error) is reported as an abstention: certainty "low".
import Foundation
import FoundationModels

func emit(_ key: String, _ recruiting: String, _ quote: String, _ certainty: String) {
    let o: [String: Any] = ["key": key, "recruiting": recruiting, "type": NSNull(), "stage": NSNull(), "company_candidate": NSNull(), "company_quote": NSNull(), "role_quote": NSNull(), "date_quote": NSNull(), "evidence_quote": quote.isEmpty ? NSNull() : String(quote.prefix(120)) as Any, "certainty": certainty]
    if let d = try? JSONSerialization.data(withJSONObject: o), let s = String(data: d, encoding: .utf8) { print(s); fflush(stdout) }
}

@main
struct App {
    static func main() async {
        guard CommandLine.arguments.count > 1, let guide = try? String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8) else {
            FileHandle.standardError.write("usage: oi-semantic <guide.md>\n".data(using: .utf8)!); exit(2)
        }
        guard case .available = SystemLanguageModel.default.availability else {
            FileHandle.standardError.write("on-device language model unavailable\n".data(using: .utf8)!); exit(3)
        }
        let instructions = "You are a careful email classifier. Follow this guide. Answer only about whether the email is part of this person's own hiring process.\n\n" + guide.prefix(3200)
        while let line = readLine() {
            guard let data = line.data(using: .utf8), let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let key = obj["key"] as? String else { continue }
            let from = (obj["from"] as? String) ?? "", subject = (obj["subject"] as? String) ?? "", body = (obj["body"] as? String) ?? ""
            let prompt = "From: \(from)\nSubject: \(subject)\n\n\(String(body.prefix(1100)))"
            do {
                let session = LanguageModelSession(instructions: instructions)
                let r = try await session.respond(to: prompt + "\n\nReply with ONLY one JSON object on one line, no other text: {\"recruiting\":\"yes\" or \"no\",\"evidence_quote\":\"an exact quote of at most 120 characters copied from the email\",\"certainty\":\"high\" or \"medium\" or \"low\"}")
                let text = r.content
                guard let lo = text.firstIndex(of: "{"), let hi = text.lastIndex(of: "}"), lo < hi,
                      let d = String(text[lo...hi]).data(using: .utf8), let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
                      let rec = j["recruiting"] as? String, rec == "yes" || rec == "no" else { emit(key, "no", "", "low"); continue }
                let cert = (j["certainty"] as? String) ?? "low"
                emit(key, rec, (j["evidence_quote"] as? String) ?? "", ["high", "medium", "low"].contains(cert) ? cert : "low")
            } catch {
                emit(key, "no", "", "low")
            }
        }
    }
}
