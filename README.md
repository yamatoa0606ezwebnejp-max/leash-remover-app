[README.md](https://github.com/user-attachments/files/30822889/README.md)
# LeashOff

> Remove the leash. Keep the dog.

## What it does

LeashOff removes leashes — and the hand holding them — from dog walking photos, then exports a print-ready image. No manual tracing, no touch-ups, no losing the shot to a strap across the frame.

## Who it's for

For people who want to keep, frame, or share a single photo, not just log a walk:

- Owners building photo books or calendars
- Pet accounts on social media
- Rescue and foster organizations preparing adoption photos
- Pet photographers

## The problem

Walk photos often have great framing and a great expression — ruined by a leash and a hand in the shot. Existing tools don't quite solve it:

- **Generic AI photo editors** (e.g. Google Photos Magic Eraser) don't know what *not* to touch — bandanas, collars, and patterns get erased along with the leash, and the dog itself can shift subtly.
- **Photoshop/Lightroom** can do it, but cloning out a long, thin, curved leash by hand is slow, tedious work.
- **Existing specialized apps** require tracing the leash with a finger — the worst possible input method for a thin, long, curved shape.
- **Web-based tools** need a computer, so there's no fixing the photo on the spot, right after the walk.

## What makes it different

**1. No tracing.** The leash is thin, long, and curved — exactly the shape a finger is worst at tracing. LeashOff detects it automatically. The only thing the user does is confirm.

**2. The dog stays intact.** Because the model is built for one specific object — a line running from collar to hand — it knows what to leave alone: fur, coat pattern, bandana, clothing. Users can also choose to keep or remove the collar itself, something generic tools can't offer.

**3. Mobile to export, in one pass.** Removal isn't the finish line — the app exports print-ready resolution too. By the time the walk is over, there's already a frame-worthy photo.

## Status

Early development — Shipaton 2026 submission project.
