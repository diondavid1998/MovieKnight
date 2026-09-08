//
//  ViewHelpers.swift
//  WhatsOn
//
// The preview, and the view modifiers shared across the app.
//

import SwiftUI

// MARK: - Preview

#Preview {
    ContentView()
        .environment(ThemeManager.shared)
}

// MARK: - View Helpers

extension View {
    @ViewBuilder
    func disableAutocap() -> some View {
        #if os(iOS)
        self.textInputAutocapitalization(.never)
        #else
        self
        #endif
    }

    func glassSurface(radius: CGFloat = 18, interactive: Bool = false) -> some View {
        modifier(GlassSurface(radius: radius, interactive: interactive))
    }
}

struct GlassSurface: ViewModifier {
    let radius: CGFloat
    let interactive: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        if interactive {
            content.glassEffect(.regular.interactive(), in: shape)
        } else {
            content.glassEffect(.regular, in: shape)
        }
    }
}

// MARK: - Wrapping row

/// An `HStack` that wraps onto the next line when it runs out of width.
///
/// SwiftUI has no such stack. The usual workarounds are a horizontal `ScrollView`,
/// which hides everything past the edge behind a gesture nobody knows to make,
/// or a fixed grid, which either clips a long label or leaves a lane of space
/// beside a short one. Neither suits chips whose width is a genre name.
///
/// It is a `Layout` rather than a `GeometryReader` sizing pass so it reports a
/// real height to its parent: nested in a `ScrollView` the geometry version
/// measures zero on the first pass and settles a frame later, which is visible
/// as a jump on screen.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6
    /// Vertical gap between lines. Defaults to the horizontal spacing.
    var lineSpacing: CGFloat?

    private struct Lines {
        var rows: [[Int]]
        var sizes: [CGSize]
    }

    private func lines(_ proposal: ProposedViewSize, _ subviews: Subviews) -> Lines {
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        // No width proposed means "how big would you like to be" — one line.
        guard let maxWidth = proposal.width, maxWidth > 0 else {
            return Lines(rows: subviews.isEmpty ? [] : [Array(subviews.indices)], sizes: sizes)
        }
        var rows: [[Int]] = []
        var current: [Int] = []
        var x: CGFloat = 0
        for index in subviews.indices {
            let width = sizes[index].width
            // An item wider than the line still gets a line of its own rather
            // than being dropped or wrapped into nothing.
            if !current.isEmpty && x + spacing + width > maxWidth {
                rows.append(current)
                current = [index]
                x = width
            } else {
                if !current.isEmpty { x += spacing }
                current.append(index)
                x += width
            }
        }
        if !current.isEmpty { rows.append(current) }
        return Lines(rows: rows, sizes: sizes)
    }

    private func height(of row: [Int], _ sizes: [CGSize]) -> CGFloat {
        row.map { sizes[$0].height }.max() ?? 0
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let laid = lines(proposal, subviews)
        guard !laid.rows.isEmpty else { return .zero }
        let gap = lineSpacing ?? spacing
        let widest = laid.rows.map { row in
            row.reduce(0) { $0 + laid.sizes[$1].width } + spacing * CGFloat(max(row.count - 1, 0))
        }.max() ?? 0
        let total = laid.rows.reduce(0) { $0 + height(of: $1, laid.sizes) }
            + gap * CGFloat(max(laid.rows.count - 1, 0))
        return CGSize(width: proposal.width ?? widest, height: total)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let laid = lines(proposal, subviews)
        let gap = lineSpacing ?? spacing
        var y = bounds.minY
        for row in laid.rows {
            let lineHeight = height(of: row, laid.sizes)
            var x = bounds.minX
            for index in row {
                subviews[index].place(
                    at: CGPoint(x: x, y: y + (lineHeight - laid.sizes[index].height) / 2),
                    proposal: ProposedViewSize(laid.sizes[index])
                )
                x += laid.sizes[index].width + spacing
            }
            y += lineHeight + gap
        }
    }
}
