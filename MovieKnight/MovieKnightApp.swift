//
//  MovieKnightApp.swift
//  MovieKnight
//
//  Created by Dion David on 4/7/26.
//

import SwiftUI

@main
struct MovieKnightApp: App {
    let persistenceController = PersistenceController.shared

    var body: some Scene {
        WindowGroup {
            LoginView()
        }
    }
}
