//
//  ContentView.swift
//  MovieKnight
//
//  Created by Dion David on 4/7/26.
//

import SwiftUI
import CoreData

struct ContentView: View {
    @Environment(\.managedObjectContext) private var viewContext

    @FetchRequest(
        sortDescriptors: [NSSortDescriptor(keyPath: \Item.timestamp, ascending: true)],
        animation: .default)
    private var items: FetchedResults<Item>

    var body: some View {
        NavigationView {
            List {
                ForEach(items) { item in
                    NavigationLink {
                        Text("Item at \(item.timestamp!, formatter: itemFormatter)")
                    } label: {
                        Text(item.timestamp!, formatter: itemFormatter)
                    }
                }
                .onDelete(perform: deleteItems)
            }
            .toolbar {
#if os(iOS)
                ToolbarItem(placement: .navigationBarTrailing) {
                    EditButton()
                }
#endif
                ToolbarItem {
                    Button(action: addItem) {
                        Label("Add Item", systemImage: "plus")
                    }
                }
            }
            Text("Select an item")
        }
    }

    private func addItem() {
        withAnimation {
            let newItem = Item(context: viewContext)
            newItem.timestamp = Date()

            do {
                try viewContext.save()
            } catch {
                // Replace this implementation with code to handle the error appropriately.
                // fatalError() causes the application to generate a crash log and terminate. You should not use this function in a shipping application, although it may be useful during development.
                let nsError = error as NSError
                fatalError("Unresolved error \(nsError), \(nsError.userInfo)")
            }
        }
    }

    private func deleteItems(offsets: IndexSet) {
        withAnimation {
            offsets.map { items[$0] }.forEach(viewContext.delete)

            do {
                try viewContext.save()
            } catch {
                // Replace this implementation with code to handle the error appropriately.
                // fatalError() causes the application to generate a crash log and terminate. You should not use this function in a shipping application, although it may be useful during development.
                let nsError = error as NSError
                fatalError("Unresolved error \(nsError), \(nsError.userInfo)")
            }
        }
    }
}

private let itemFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateStyle = .short
    formatter.timeStyle = .medium
    return formatter
}()

struct ContentView_Previews: PreviewProvider {
    static var previews: some View {
        ContentView().environment(\.managedObjectContext, PersistenceController.preview.container.viewContext)
    }
}

struct LoginView: View {
    @State private var username = ""
    @State private var password = ""
    @State private var error: String?
    @State private var isLoggedIn = false
    @State private var token: String?

    var body: some View {
        VStack(spacing: 20) {
            Text("Login").font(.largeTitle)
            TextField("Username", text: $username)
                .textFieldStyle(RoundedBorderTextFieldStyle())
            SecureField("Password", text: $password)
                .textFieldStyle(RoundedBorderTextFieldStyle())
            if let error = error {
                Text(error).foregroundColor(.red)
            }
            Button("Login") {
                login()
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
        .fullScreenCover(isPresented: $isLoggedIn) {
            PlatformSelectionView(token: token ?? "")
        }
    }

    func login() {
        guard let url = URL(string: "\(API.baseURL)/login") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body = ["username": username, "password": password]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: req) { data, response, error in
            guard let data = data else { return }
            let resp = try? JSONDecoder().decode(AuthResponse.self, from: data)
            DispatchQueue.main.async {
                if let token = resp?.token {
                    self.token = token
                    self.isLoggedIn = true
                } else {
                    self.error = resp?.error ?? "Login failed"
                }
            }
        }.resume()
    }
}

struct PlatformSelectionView: View {
    let token: String
    @State private var platforms: [String] = []
    @State private var selected: [String] = []
    @State private var error: String?
    @State private var isNext = false
    let allPlatforms = ["Netflix", "Hulu", "Prime", "Disney", "Paramount"]

    var body: some View {
        VStack(spacing: 20) {
            Text("Select Platforms").font(.title)
            ForEach(allPlatforms, id: \.self) { platform in
                Toggle(platform, isOn: Binding(
                    get: { selected.contains(platform.lowercased()) },
                    set: { on in
                        if on {
                            selected.append(platform.lowercased())
                        } else {
                            selected.removeAll { $0 == platform.lowercased() }
                        }
                    }
                ))
            }
            if let error = error {
                Text(error).foregroundColor(.red)
            }
            Button("Save") {
                savePlatforms()
            }
            .buttonStyle(.borderedProminent)
            Button("Next") {
                isNext = true
            }
            .buttonStyle(.bordered)
        }
        .padding()
        .onAppear(perform: fetchPlatforms)
        .fullScreenCover(isPresented: $isNext) {
            MovieListView(token: token)
        }
    }

    func fetchPlatforms() {
        guard let url = URL(string: "\(API.baseURL)/platforms") else { return }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        URLSession.shared.dataTask(with: req) { data, _, _ in
            guard let data = data else { return }
            let resp = try? JSONDecoder().decode(PlatformResponse.self, from: data)
            DispatchQueue.main.async {
                self.selected = resp?.platforms ?? []
            }
        }.resume()
    }

    func savePlatforms() {
        guard let url = URL(string: "\(API.baseURL)/platforms") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "PUT"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body = ["platforms": selected]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: req) { data, _, _ in
            guard let data = data else { return }
            let resp = try? JSONDecoder().decode([String: Bool].self, from: data)
            DispatchQueue.main.async {
                if resp?["success"] == true {
                    error = nil
                } else {
                    error = "Failed to save"
                }
            }
        }.resume()
    }
}

struct MovieListView: View {
    let token: String
    @State private var movies: [Movie] = []
    @State private var error: String?
    var body: some View {
        VStack {
            Text("Movies").font(.title)
            if let error = error {
                Text(error).foregroundColor(.red)
            }
            List(movies) { movie in
                VStack(alignment: .leading) {
                    Text(movie.title).font(.headline)
                    if let overview = movie.overview {
                        Text(overview).font(.subheadline)
                    }
                    if let date = movie.release_date {
                        Text("Release: \(date)").font(.caption)
                    }
                }
            }
        }
        .onAppear(perform: fetchMovies)
    }
    func fetchMovies() {
        guard let url = URL(string: "\(API.baseURL)/movies") else { return }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        URLSession.shared.dataTask(with: req) { data, _, _ in
            guard let data = data else { return }
            let resp = try? JSONDecoder().decode(MoviesResponse.self, from: data)
            DispatchQueue.main.async {
                self.movies = resp?.movies ?? []
            }
        }.resume()
    }
}
