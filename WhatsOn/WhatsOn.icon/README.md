# WhatsOn.icon — Liquid Glass App Icon

> ⛔ **BUILD SETTING WARNING**
>
> `ASSETCATALOG_COMPILER_APPICON_NAME` **must remain `AppIcon`** until this `.icon` bundle
> has been opened in Icon Composer, populated with real layered artwork, and saved.
>
> `actool` only recognises a `.icon` bundle that Icon Composer itself generated and saved.
> The hand-authored `icon.json` in this directory is a best-effort placeholder — `actool`
> will reject it and the build will fail with:
>
> ```
> None of the input catalogs contained a matching … app icon set, or icon stack named "WhatsOn".
> ```
>
> **Only switch the setting to `WhatsOn` after completing the Icon Composer workflow
> described below and confirming the build succeeds locally.**

## What this bundle is

`WhatsOn.icon` is an **Icon Composer** bundle for an iOS 26 Liquid Glass app icon.
It contains a layered manifest (`icon.json`) plus background and foreground artwork for the
**Spark Play** mark: a gold play triangle beside a cream four-point spark on a warm-black
plate.

The three PNGs in `Assets/` are **generated, not hand-drawn**. `npm run icons` cuts them out
of `design/whatson-icon.svg` — the same file the flat `AppIcon.appiconset` comes from — by
hiding one layer group and rasterising the rest. Do not edit them by hand: the next run of
the script will overwrite the change, and the flat icon and this bundle will disagree in the
meantime. Edit the SVG and re-run instead.

---

## How to complete the icon in Icon Composer

### Prerequisites
- Xcode 26 or later (includes Icon Composer)
- Nothing else: the layered source is already in the repo as
  `design/whatson-icon.svg`, and `Assets/` holds it pre-separated.

### Step-by-step workflow

1. **Open Icon Composer**
   In Xcode 26: *File ▶ Open* → select `WhatsOn/WhatsOn.icon`.
   Icon Composer will read `icon.json` and display the layer stack.

2. **Refine the included layers if needed**

   | Layer | What is in it |
   |-------|-----------------|
   | **Background** (Default / Light) | The warm-black plate, `#241809` → `#120C04`, with the top sheen. |
   | **Background** (Dark) | The same plate one stop down, `#150E05` → `#080502`. |
   | **Foreground** | The gold play triangle and cream spark, on transparency, so the glass system can light them. |

3. **Tune per-layer glass settings**
   Select each layer and adjust the *Specular*, *Refraction*, and *Shadow* sliders in the
   Inspector panel to achieve the desired glass depth.

4. **Preview all four appearance variants**
   Use the variant switcher at the top of the canvas to verify:
   - **Default** (light system appearance)
   - **Dark** (dark system appearance)
   - **Clear** (wallpaper shows through)
   - **Tinted** (user-chosen tint colour)

5. **Save**
   *⌘S* — Icon Composer writes the updated manifest and any embedded asset data back into
   the `.icon` bundle. Xcode picks it up automatically on the next build.

---

## How it is wired into the Xcode project

`project.pbxproj` currently sets:

```
ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
```

for all build configurations. This points the asset-catalog compiler at
`Assets.xcassets/AppIcon.appiconset`, which contains the working flat icon and builds
successfully today.

Once you have completed the Icon Composer workflow below and saved a valid `.icon` bundle,
change the setting in **both** the Debug and Release configurations to:

```
ASSETCATALOG_COMPILER_APPICON_NAME = WhatsOn;
```

That tells the compiler to use `WhatsOn.icon` (matched by basename) as the primary
app icon for iOS 26+. **Do not make this change before Icon Composer has saved the bundle**
— the hand-authored `icon.json` is not a valid `actool` input and the build will fail.

**The existing `AppIcon.appiconset` is kept unchanged** as the fallback for devices running
iOS 25 and earlier. No deletion is needed; the build system selects the appropriate icon
automatically based on the OS version.

---

## Colour reference (Klieg — Spark Play)

| Token | Hex | Use |
|-------|-----|-----|
| `kliegGold` | `#FFC24D` | The play triangle. 3200 K tungsten warmed a little — the colour of a film lamp, not of a UI accent. |
| `kliegCream` | `#FFF3D6` | The spark, and the top sheen at 10 % opacity. |
| `plateTop` | `#241809` | Background gradient start |
| `plateBottom` | `#120C04` | Background gradient end, and the flatten colour for every opaque export |
| `plateTopDark` | `#150E05` | Dark-appearance gradient start |
| `plateBottomDark` | `#080502` | Dark-appearance gradient end |

These are defined once, in `design/whatson-icon.svg`. This table is a reading of that file,
not a second source — if the two ever disagree, the SVG is right.

---

## Notes for reviewers / maintainers

- The included PNG layers already match the shipping flat icon, but opening and re-saving
  the bundle in Icon Composer is still recommended if you want Xcode to emit the final
  system-authored Liquid Glass variant. Note that re-saving may rewrite `icon.json` into
  whatever schema Xcode currently expects, and may embed the layer images — after which
  `npm run icons` no longer feeds this bundle and the two can drift. Re-check that the
  script's `composerDir` outputs are still the files the bundle reads.
- The `icon.json` manifest schema used here is a best-effort representation of the Icon
  Composer format as documented for Xcode 26 beta. Open and re-save the bundle in Icon
  Composer to normalise the format to whatever schema Xcode currently expects.
- Vectors (PDF/SVG) or transparent PNGs are preferred for each layer; avoid importing the
  flattened `AppIcon.png` as a layer because the glass system cannot decompose it. Import
  `design/whatson-icon.svg` if you want the vector.
