import Foundation

struct API {
    static let baseURL = "http://localhost:4000" // Change if backend runs elsewhere
}

struct AuthResponse: Codable {
    let token: String?
    let error: String?
}

struct PlatformResponse: Codable {
    let platforms: [String]
}

struct Movie: Codable, Identifiable {
    let id: Int
    let title: String
    let overview: String?
    let poster_path: String?
    let release_date: String?
}

struct MoviesResponse: Codable {
    let movies: [Movie]
}

struct Review: Codable {
    let Source: String
    let Value: String
}

struct ReviewsResponse: Codable {
    let ratings: [Review]
}
