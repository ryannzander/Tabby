# apps/mobile — React Native chat client (not started)

Placeholder. The web app in `apps/web` ships first; this comes after, and shares the same
tRPC API and the same `@flippy/protocol` types.

## Decided
- React Native.

## Not decided yet — resolve before writing code
- Expo vs bare React Native.
- Whether it reuses the tRPC client directly or talks to a thin REST wrapper.
- Whether the phone can ever be the approval device (it must not be, or the "separate physical
  device" property collapses — the phone is where the agent chat lives).

Nothing here blocks any other workstream.
