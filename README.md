# 🇵🇭 Pantalan Jelly — 3D Interactive Diorama

An interactive, procedural 3D diorama of an authentic Philippine coastal port (*Pantalan*) embedded inside a translucent tropical sea jelly block, built with **Next.js 14 (App Router)**, **TypeScript**, **Tailwind CSS**, and pure **Three.js**.

> **Engineered by Dylan Ramos**

---

## ✨ Features

- **Translucent Tropical Sea Jelly Block**:
  - High-subdivision procedural rounded-box geometry resting on a warm Narra/Acacia hardwood plinth with engraved satin brass commemorative plaque.
  - Custom WebGL2 vertex shader with quadratic height-weighted shear wobble physics, Gerstner ocean swells, and radial ripple waves on click/poke.
  - Real-time deformed normal recalculation using finite-difference tangent cross-products for distortion-free PBR transmission and refraction.

- **Realistic Scale Hierarchy & Philippine Cultural Details**:
  - **Flagship Ro-Ro Inter-Island Passenger Ship (`M/V PANTALAN EXPRESS`)**: Imposing vessel with anti-fouling red hull, lowered vehicle ramp resting on the wharf apron, 28 cabin windows, bridge wings, dual aerodynamic funnels, and rotating radar scanner.
  - **Iconic Sarao Jeepney ("King of the Road")**: Sized to authentic scale, featuring 4 gold hood horses, bullbar, route signage, passenger vinyl benches, and roof-rack cargo (Balikbayan boxes with customs tape, rice sacks, and mango crates).
  - **Marine Concrete Pantalan Wharf**: Reinforced concrete with yellow/black hazard curb striping, algae waterline stains, heavy-duty rubber dock fenders, double-bitt cast iron bollards, passenger kubo shed, and fiesta banderitas.
  - **Traditional Stilt Fisherman's Hut (`Bahay Kubo sa Laot`)**: Offshore bamboo stilts with algae collars, woven sawali walls, nipa thatch roof, hanging *bubo* fish trap, access ladder, and moored *baroto* canoe.
  - **El Nido / Coron Karst Cliffs & Spanish Parola**: Steep craggy limestone islet with natural sea arch and a historic coral stone lighthouse with rotating volumetric light beam.
  - **White Sand Sandbar & Leaning Coconut Palms**: Organically curved coconut palms with ringed bark, 3D arched fronds with pinnate leaflets, and clusters of coconuts swaying in the sea breeze.
  - **Traditional Sailing Paraw**: Authentic double-outrigger sailboat with tall mast, arched bamboo *katig*, and vibrant multi-colored *layag* sail billowing in the wind.
  - **Tropical Marine Life**: Sea turtle (*pawikan*) with swimming flippers, schooling reef fish, giant fluted clam (*taklobo*) with electric-cyan mantle, and animated caustic light patterns on the white sand seabed.

- **Interactive HUD & Controls**:
  - 5 Cinematic Camera Presets: `Overview`, `Pantalan`, `Reef & Clam`, `Parola`, `Sandbar & Paraw`.
  - Interactive "Poke Jelly" impulse button and direct raycast clicks anywhere on the sea jelly block.
  - Real-time lighting toggle: **Noon Sun** ↔ **Manila Bay Sunset** (warm golden hour transition with glowing beacons and lanterns).
  - Telemetry readouts: Jelly Energy, FPS counter, lighting mode, and live **Unique Visitors & Page Views** tracking (zero database required).
  - Dedication badges & commemorative plaques honoring Dylan Ramos.

---

## 🛠️ Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript (Strict typing, 0 `any` types)
- **3D Graphics**: Vanilla Three.js (`three`, `OrbitControls`, `RoomEnvironment`)
- **Styling**: Tailwind CSS
- **Textures & Shaders**: 100% Procedural canvas textures & custom GLSL vertex shader injection

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18.17+ or newer
- npm or pnpm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/Dyl4nweb/Pantalan.git
cd Pantalan

# Install dependencies
npm install

# Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Production Build

```bash
npm run build
npm start
```

---

## 📜 License

Created with pride for Philippine maritime and cultural heritage. Engineered by Dylan Ramos.

