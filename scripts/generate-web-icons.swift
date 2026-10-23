// Run on macOS: swift scripts/generate-web-icons.swift
// Rasterize the existing shield emoji so installed icons do not depend on the
// browser's emoji font metrics. PNGs are committed; deployment needs no Swift.
import AppKit

func bitmap(_ size: Int) -> NSBitmapImageRep {
    let image = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
        isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: size * 4, bitsPerPixel: 32
    )!
    image.size = NSSize(width: size, height: size)
    return image
}

let source = bitmap(1024)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: source)
("🛡️" as NSString).draw(
    at: NSPoint(x: 200, y: 200),
    withAttributes: [.font: NSFont(name: "AppleColorEmoji", size: 600)!]
)
NSGraphicsContext.restoreGraphicsState()

// Use visible pixels, not the text line box, to give the shield equal margins.
let pixels = source.bitmapData!
var minX = source.pixelsWide, minY = source.pixelsHigh, maxX = -1, maxY = -1
for y in 0..<source.pixelsHigh {
    for x in 0..<source.pixelsWide {
        if pixels[y * source.bytesPerRow + x * 4 + 3] > 0 {
            minX = min(minX, x)
            maxX = max(maxX, x)
            minY = min(minY, y)
            maxY = max(maxY, y)
        }
    }
}
precondition(maxX >= minX && maxY >= minY, "Shield emoji did not render")
let bounds = CGRect(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1)
let cropped = source.cgImage!.cropping(to: bounds)!
let shield = NSImage(cgImage: cropped, size: bounds.size)
let destination = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("packages/web/app/public/icons", isDirectory: true)
try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)

for (filename, size) in [
    ("favicon-32.png", 32),
    ("apple-touch-icon.png", 180),
    ("icon-192.png", 192),
    ("icon-512.png", 512),
] {
    let output = bitmap(size)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: output)
    NSGraphicsContext.current!.imageInterpolation = .high
    // Opaque, square background; iOS applies its own rounded corner mask.
    NSColor(srgbRed: 240 / 255, green: 242 / 255, blue: 245 / 255, alpha: 1).setFill()
    NSRect(x: 0, y: 0, width: size, height: size).fill()
    let scale = Double(size) * 0.72 / max(bounds.width, bounds.height)
    let width = bounds.width * scale, height = bounds.height * scale
    shield.draw(in: NSRect(
        x: (Double(size) - width) / 2, y: (Double(size) - height) / 2,
        width: width, height: height
    ))
    NSGraphicsContext.restoreGraphicsState()
    try output.representation(using: .png, properties: [:])!
        .write(to: destination.appendingPathComponent(filename))
    print("Generated \(filename) (\(size)×\(size))")
}
