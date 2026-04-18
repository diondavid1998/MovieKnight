import Foundation

// MARK: - API Config

struct API {
    // For Simulator use localhost. For a physical device, replace with your Mac's LAN IP, e.g. "http://192.168.1.100:4000"
    static let baseURL = "http://localhost:4000"
    static let appName = "StreamScore"
}

// MARK: - Errors

enum APIError: LocalizedError {
    case unauthorized
    case serverError(Int)
    case decodingError
    case networkError(Error)

    var errorDescription: String? {
        switch self {
        case .unauthorized:          return "Session expired — please sign in again."
        case .serverError(let c):    return "Server error (\(c))."
        case .decodingError:         return "Unexpected server response."
        case .networkError(let e):   return e.localizedDescription
        }
    }
}

// MARK: - Auth

struct AuthResponse: Codable {
    let token: String?
    let error: String?
}

// MARK: - Platforms

struct PlatformResponse: Codable {
    let platforms: [String]
}

struct GenericResponse: Codable {
    let success: Bool?
    let ok: Bool?
    let error: String?
}

// MARK: - Catalog

struct CatalogItem: Identifiable {
    var id: String
    var title: String
    var mediaType: String?
    var year: Int?
    var overview: String?
    var posterUrl: String?
    var genres: [String]?
    var availableOn: [String]?
    var popularity: Double?
    var tmdbRating: Double?
    var tmdbVotes: Int?
    var imdbRating: String?
    var imdbVotes: String?
    var rottenTomatoesRating: String?
    var rottenTomatoesAudience: String?
    var metacriticRating: String?
    var metacriticAudience: String?
}

extension CatalogItem: Codable {
    enum CodingKeys: String, CodingKey {
        case id, title, mediaType, year, overview, posterUrl, genres, availableOn
        case popularity, tmdbRating, tmdbVotes
        case imdbRating, imdbVotes
        case rottenTomatoesRating, rottenTomatoesAudience
        case metacriticRating, metacriticAudience
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // id can arrive as Int or String depending on TMDB source
        if let s = try? c.decode(String.self, forKey: .id) {
            id = s
        } else if let i = try? c.decode(Int.self, forKey: .id) {
            id = String(i)
        } else {
            id = UUID().uuidString
        }
        title                  = (try? c.decode(String.self,   forKey: .title))                  ?? "Unknown Title"
        mediaType              = try? c.decode(String.self,    forKey: .mediaType)
        year                   = try? c.decode(Int.self,       forKey: .year)
        overview               = try? c.decode(String.self,    forKey: .overview)
        posterUrl              = try? c.decode(String.self,    forKey: .posterUrl)
        genres                 = try? c.decode([String].self,  forKey: .genres)
        availableOn            = try? c.decode([String].self,  forKey: .availableOn)
        popularity             = try? c.decode(Double.self,    forKey: .popularity)
        tmdbRating             = try? c.decode(Double.self,    forKey: .tmdbRating)
        tmdbVotes              = try? c.decode(Int.self,       forKey: .tmdbVotes)
        imdbRating             = try? c.decode(String.self,    forKey: .imdbRating)
        imdbVotes              = try? c.decode(String.self,    forKey: .imdbVotes)
        rottenTomatoesRating   = try? c.decode(String.self,    forKey: .rottenTomatoesRating)
        rottenTomatoesAudience = try? c.decode(String.self,    forKey: .rottenTomatoesAudience)
        metacriticRating       = try? c.decode(String.self,    forKey: .metacriticRating)
        metacriticAudience     = try? c.decode(String.self,    forKey: .metacriticAudience)
    }
}

struct CatalogMeta: Codable {
    let page: Int?
    let totalPages: Int?
    let resultCount: Int?
    let visibleCount: Int?
    let platformCount: Int?
    let lastUpdatedAt: String?
    let refreshing: Bool?
    let languages: [String]?
}

struct CatalogResponse: Codable {
    let items: [CatalogItem]?   // backend returns "items"
    let movies: [CatalogItem]?  // fallback key
    let meta: CatalogMeta?
    let error: String?

    var catalog: [CatalogItem] { items ?? movies ?? [] }
}

// MARK: - API Service

final class APIService {
    static let shared = APIService()
    private init() {}

    func get<T: Decodable>(_ path: String, params: [String: String] = [:], token: String? = nil) async throws -> T {
        guard var components = URLComponents(string: API.baseURL + path) else {
            throw APIError.networkError(URLError(.badURL))
        }
        if !params.isEmpty {
            components.queryItems = params.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = components.url else { throw APIError.networkError(URLError(.badURL)) }
        var req = URLRequest(url: url, timeoutInterval: 30)
        req.httpMethod = "GET"
        if let t = token, !t.isEmpty { req.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization") }
        return try await perform(req)
    }

    func post<T: Decodable>(_ path: String, body: [String: Any], token: String? = nil) async throws -> T {
        guard let url = URL(string: API.baseURL + path) else {
            throw APIError.networkError(URLError(.badURL))
        }
        var req = URLRequest(url: url, timeoutInterval: 30)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let t = token, !t.isEmpty { req.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization") }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await perform(req)
    }

    func put<T: Decodable>(_ path: String, body: [String: Any], token: String? = nil) async throws -> T {
        guard let url = URL(string: API.baseURL + path) else {
            throw APIError.networkError(URLError(.badURL))
        }
        var req = URLRequest(url: url, timeoutInterval: 30)
        req.httpMethod = "PUT"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let t = token, !t.isEmpty { req.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization") }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await perform(req)
    }

    private func perform<T: Decodable>(_ req: URLRequest) async throws -> T {
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(for: req)
        } catch {
            throw APIError.networkError(error)
        }
        if let http = response as? HTTPURLResponse {
            if http.statusCode == 401 { throw APIError.unauthorized }
            if http.statusCode >= 500 { throw APIError.serverError(http.statusCode) }
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decodingError
        }
    }
}
