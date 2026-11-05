"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

// --- TYPES & INTERFACES (Strict TypeScript: 0 any types) ---

interface JellyUniforms {
  uTime: { value: number };
  uWobbleX: { value: number };
  uWobbleZ: { value: number };
  uPokePos: { value: THREE.Vector3 };
  uPokeAmp: { value: number };
  uPokeTime: { value: number };
}

interface FishData {
  group: THREE.Group;
  tail: THREE.Mesh;
  finL: THREE.Mesh;
  finR: THREE.Mesh;
  orbitRadius: number;
  speed: number;
  angle: number;
  baseY: number;
  swimFreq: number;
  phase: number;
  verticalAmp: number;
}

interface BirdData {
  group: THREE.Group;
  wingLeft: THREE.Mesh;
  wingRight: THREE.Mesh;
  orbitRadius: number;
  speed: number;
  angle: number;
  baseY: number;
  flapSpeed: number;
  bankFactor: number;
}

interface BubbleData {
  mesh: THREE.Mesh;
  speed: number;
  resetY: number;
  maxY: number;
  wobbleSpeed: number;
  wobbleOffset: number;
}

interface CruisingBangka {
  group: THREE.Group;
  wakeGroup: THREE.Group;
  t: number;
  speed: number;
  propeller: THREE.Mesh;
}

interface SeagrassData {
  mesh: THREE.Mesh;
  baseRotationZ: number;
  freq: number;
  phase: number;
  swayAmp: number;
}

type CameraPreset = "overview" | "pier" | "reef" | "parola" | "sandbar";

// --- CPU DISPLACEMENT SAMPLER (MIRRORS EXACT GLSL VERTEX MATH) ---

function sampleJellyDisplacement(
  x: number,
  y: number,
  z: number,
  time: number,
  wobbleX: number,
  wobbleZ: number,
  pokePos: THREE.Vector3,
  pokeAmp: number,
  pokeTime: number
): { dx: number; dy: number; dz: number } {
  // Height-weighted quadratic shear: anchored at plinth y=0, max at top surface y=3.4
  const h = Math.max(0, Math.min(1, y / 3.4));
  const w = h * h;
  const dx = wobbleX * w;
  const dz = wobbleZ * w;

  // Realistic Gerstner ocean wave interference near surface
  const swellFactor = Math.max(0, Math.min(1, (y - 1.5) / 1.9));
  
  const w1 = Math.sin((x * 0.7 + z * 0.7) * 1.3 - time * 2.0) * 0.042;
  const w2 = Math.sin((x * -0.5 + z * 0.86) * 2.4 - time * 2.9) * 0.018;
  const w3 = Math.sin((x * 0.9 - z * 0.4) * 4.2 - time * 4.4) * 0.009;
  const totalSwell = (w1 + w2 + w3) * swellFactor;

  // Localized radial damped ripple from user poke
  let ripple = 0;
  if (pokeAmp > 0.001 && pokeTime < 3.2) {
    const dist = Math.hypot(x - pokePos.x, z - pokePos.z);
    ripple =
      pokeAmp *
      Math.sin(dist * 9.5 - pokeTime * 14.5) *
      Math.exp(-dist * 1.15) *
      Math.exp(-pokeTime * 2.1) *
      w;
  }

  const dy = totalSwell + ripple;
  return { dx, dy, dz };
}

// --- PROCEDURAL ROUNDED BOX WITH SMOOTH ANALYTICAL NORMALS ---

function createSmoothRoundedBoxGeometry(
  width: number,
  height: number,
  depth: number,
  radius: number,
  subdivisions: number
): THREE.BufferGeometry {
  const box = new THREE.BoxGeometry(
    width,
    height,
    depth,
    subdivisions,
    Math.round(subdivisions * (height / width)),
    subdivisions
  );

  const pos = box.attributes.position;
  const norm = box.attributes.normal;

  const hx = width * 0.5 - radius;
  const hy = height * 0.5 - radius;
  const hz = depth * 0.5 - radius;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    const cx = Math.max(-hx, Math.min(hx, x));
    const cy = Math.max(-hy, Math.min(hy, y));
    const cz = Math.max(-hz, Math.min(hz, z));

    const dx = x - cx;
    const dy = y - cy;
    const dz = z - cz;

    const len = Math.hypot(dx, dy, dz);
    if (len > 0.0001) {
      const nx = dx / len;
      const ny = dy / len;
      const nz = dz / len;

      pos.setXYZ(i, cx + nx * radius, cy + ny * radius, cz + nz * radius);
      norm.setXYZ(i, nx, ny, nz);
    }
  }

  box.computeVertexNormals();
  // Translate so bottom sits on plinth (y = 0) and top is at y = height (3.4)
  box.translate(0, height * 0.5, 0);
  return box;
}

// --- PROCEDURAL TEXTURE GENERATORS ---

// 1. Philippine Narra / Acacia Hardwood Plinth Texture
function createNarraWoodTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const grad = ctx.createLinearGradient(0, 0, 1024, 1024);
  grad.addColorStop(0, "#38180c");
  grad.addColorStop(0.5, "#4a2111");
  grad.addColorStop(1, "#32140a");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 1024);

  for (let i = 0; i < 900; i++) {
    const y = Math.random() * 1024;
    const h = 1.5 + Math.random() * 4.0;
    ctx.fillStyle = i % 2 === 0 ? "rgba(24, 8, 3, 0.35)" : "rgba(102, 45, 22, 0.25)";
    ctx.fillRect(0, y, 1024, h);
  }

  ctx.strokeStyle = "rgba(22, 7, 3, 0.28)";
  ctx.lineWidth = 1.8;
  for (let j = 0; j < 55; j++) {
    ctx.beginPath();
    const cy = j * 19;
    ctx.moveTo(0, cy);
    for (let x = 0; x <= 1024; x += 32) {
      const wobble = Math.sin(x * 0.015 + j * 0.4) * 12 + Math.sin(x * 0.038) * 4;
      ctx.lineTo(x, cy + wobble);
    }
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// 2. Weathered Timber Boardwalk Planks with individual grain and nail studs
function createPierPlanksTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);

  ctx.fillStyle = "#5c4028";
  ctx.fillRect(0, 0, 1024, 1024);

  const plankHeight = 64;
  for (let y = 0; y < 1024; y += plankHeight) {
    const tone = 35 + Math.floor(Math.random() * 25);
    ctx.fillStyle = `rgb(${tone * 1.5}, ${tone * 1.05}, ${tone * 0.75})`;
    ctx.fillRect(0, y + 2, 1024, plankHeight - 4);

    ctx.fillStyle = "rgba(20, 12, 6, 0.22)";
    for (let g = 0; g < 6; g++) {
      ctx.fillRect(0, y + 8 + g * 8, 1024, 1.5);
    }

    ctx.fillStyle = "#1e130a";
    ctx.fillRect(0, y, 1024, 3);
    ctx.fillStyle = "rgba(255, 230, 200, 0.08)";
    ctx.fillRect(0, y + 3, 1024, 1.5);

    ctx.fillStyle = "#1a1614";
    [48, 112, 912, 976].forEach((nx) => {
      ctx.beginPath();
      ctx.arc(nx, y + plankHeight * 0.5, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// 3. Spanish-Colonial Whitewashed Coral Stone Texture
function createCoralStoneTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);

  ctx.fillStyle = "#ded8ce";
  ctx.fillRect(0, 0, 512, 512);

  const rowHeight = 42;
  for (let r = 0; r < 512; r += rowHeight) {
    const offset = (r / rowHeight) % 2 === 0 ? 0 : 36;
    for (let c = -offset; c < 512; c += 72) {
      const blockVar = Math.floor(Math.random() * 18);
      ctx.fillStyle = `rgb(${232 + blockVar}, ${224 + blockVar}, ${214 + blockVar})`;
      ctx.fillRect(c + 2, r + 2, 68, rowHeight - 4);

      if (Math.random() > 0.6) {
        ctx.fillStyle = "rgba(100, 85, 70, 0.15)";
        ctx.fillRect(c + 6, r + 6, 28, rowHeight - 12);
      }
    }

    ctx.fillStyle = "#9c9488";
    ctx.fillRect(0, r, 512, 2.5);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// 4. Authentic Hand-Painted Pinoy Jeepney Livery & Route Signage (1024x512 High-Res)
function createJeepneyLiveryTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // Brushed stainless steel metallic base
  const grad = ctx.createLinearGradient(0, 0, 1024, 0);
  grad.addColorStop(0, "#cbd5e1");
  grad.addColorStop(0.2, "#f8fafc");
  grad.addColorStop(0.4, "#94a3b8");
  grad.addColorStop(0.6, "#e2e8f0");
  grad.addColorStop(0.8, "#64748b");
  grad.addColorStop(1, "#cbd5e1");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 512);

  // Horizontal brushed stainless texture streaks
  ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
  for (let i = 0; i < 180; i++) {
    const y = Math.random() * 512;
    ctx.fillRect(0, y, 1024, 1.2);
  }

  // Dynamic Sarao Airbrush Flames / Speed Stripes
  const stripeLayers = [
    { y: 70, h: 44, color: "#b91c1c" },
    { y: 118, h: 36, color: "#f59e0b" },
    { y: 158, h: 40, color: "#1d4ed8" },
    { y: 202, h: 28, color: "#06b6d4" },
    { y: 234, h: 20, color: "#ec4899" },
  ];

  stripeLayers.forEach((s) => {
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.moveTo(0, s.y);
    ctx.bezierCurveTo(340, s.y + 40, 680, s.y - 30, 1024, s.y + 24);
    ctx.lineTo(1024, s.y + s.h + 24);
    ctx.bezierCurveTo(680, s.y + s.h - 30, 340, s.y + s.h + 40, 0, s.y + s.h);
    ctx.closePath();
    ctx.fill();

    // Golden airbrush highlight border
    ctx.strokeStyle = "rgba(254, 240, 138, 0.85)";
    ctx.lineWidth = 2.5;
    ctx.stroke();
  });

  // Authentic Philippine Sun & Stars Medallion (Center)
  ctx.fillStyle = "#facc15";
  ctx.beginPath();
  ctx.arc(512, 170, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#eab308";
  ctx.lineWidth = 3;
  ctx.stroke();

  // Route Billboard Header (Side Body Plaque)
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(120, 300, 784, 95);
  ctx.strokeStyle = "#eab308";
  ctx.lineWidth = 4;
  ctx.strokeRect(120, 300, 784, 95);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 38px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("PANTALAN • DOWNTOWN • PIER", 512, 355);

  ctx.fillStyle = "#38bdf8";
  ctx.font = "bold 20px sans-serif";
  ctx.fillText("★ VIA HIGHWAY - CENTRAL TERMINAL ★", 512, 382);

  // Ornate Jeepney Cultural Slogans
  ctx.fillStyle = "#facc15";
  ctx.font = "italic bold 28px serif";
  ctx.fillText("★ KING OF THE ROAD ★", 512, 50);

  ctx.fillStyle = "#dc2626";
  ctx.font = "bold 22px sans-serif";
  ctx.fillText("KATRINA & ANGELICA", 512, 435);

  ctx.fillStyle = "#f8fafc";
  ctx.font = "bold 18px sans-serif";
  ctx.fillText("“BARYA LANG PO SA UMAGA”", 512, 470);

  // Faux chrome stamped rivets
  ctx.fillStyle = "#334155";
  for (let r = 0; r < 24; r++) {
    const rx = 40 + r * 42;
    ctx.beginPath();
    ctx.arc(rx, 290, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(rx, 405, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

// 4B. Authentic Balikbayan Cardboard Box Texture with Customs Labels & Tape
function createBalikbayanBoxTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // Kraft cardboard base
  ctx.fillStyle = "#b48c58";
  ctx.fillRect(0, 0, 256, 256);

  // Cardboard grain
  ctx.fillStyle = "rgba(0, 0, 0, 0.04)";
  for (let i = 0; i < 40; i++) {
    ctx.fillRect(0, Math.random() * 256, 256, 1.5);
  }

  // Yellow / Clear packing tape cross straps
  ctx.fillStyle = "rgba(234, 179, 8, 0.8)";
  ctx.fillRect(0, 115, 256, 26);
  ctx.fillRect(115, 0, 26, 256);

  // Shipping customs label
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(20, 20, 80, 50);
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 9px sans-serif";
  ctx.fillText("FRAGILE", 26, 36);
  ctx.font = "7px sans-serif";
  ctx.fillText("MANILA, PH", 26, 48);

  // Barcode
  for (let b = 0; b < 12; b++) {
    ctx.fillRect(26 + b * 5, 52, b % 2 === 0 ? 3 : 1.5, 12);
  }

  // Red "THIS SIDE UP" arrow
  ctx.fillStyle = "#dc2626";
  ctx.font = "bold 11px sans-serif";
  ctx.fillText("↑ UP ↑", 170, 48);

  // Bold "BALIKBAYAN" stencil print
  ctx.fillStyle = "#1e3a8a";
  ctx.font = "bold 15px sans-serif";
  ctx.fillText("BALIKBAYAN", 25, 185);
  ctx.fillStyle = "#991b1b";
  ctx.font = "bold 11px sans-serif";
  ctx.fillText("HANDLE WITH CARE", 25, 205);

  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

// 4C. Philippine Inter-Island Ro-Ro Ferry Livery & Cabin Windows Texture (1024x256)
function createFerryTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // Pure maritime white superstructure
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, 1024, 256);

  // Deep Royal Navy Blue lower hull stripe
  ctx.fillStyle = "#1e3a8a";
  ctx.fillRect(0, 180, 1024, 76);

  // Philippine Golden Sun accent stripe
  ctx.fillStyle = "#f59e0b";
  ctx.fillRect(0, 168, 1024, 12);

  // Philippine Red waterline boot-topping stripe
  ctx.fillStyle = "#b91c1c";
  ctx.fillRect(0, 236, 1024, 20);

  // Panoramic passenger cabin windows with subtle tint and silver frames
  for (let w = 0; w < 28; w++) {
    const wx = 80 + w * 32;
    // Window frame
    ctx.fillStyle = "#475569";
    ctx.fillRect(wx - 1, 74, 24, 42);
    // Ocean reflective glass
    const winGrad = ctx.createLinearGradient(wx, 75, wx, 115);
    winGrad.addColorStop(0, "#0284c7");
    winGrad.addColorStop(0.5, "#0369a1");
    winGrad.addColorStop(1, "#075985");
    ctx.fillStyle = winGrad;
    ctx.fillRect(wx, 75, 22, 40);
    // Glass glare reflection
    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    ctx.beginPath();
    ctx.moveTo(wx, 75);
    ctx.lineTo(wx + 10, 75);
    ctx.lineTo(wx, 95);
    ctx.closePath();
    ctx.fill();
  }

  // Ship Name on Bow (M/V PANTALAN EXPRESS)
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 24px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("M/V PANTALAN EXPRESS", 90, 218);

  // Homeport on Stern
  ctx.font = "bold 16px sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("PORT OF CEBU • PH", 940, 218);

  // Draught Waterline Markings (Draft marks 2M, 4M, 6M)
  ctx.fillStyle = "#fef08a";
  ctx.font = "bold 10px monospace";
  ctx.textAlign = "center";
  ["6M", "4M", "2M"].forEach((mark, idx) => {
    ctx.fillText(mark, 40, 195 + idx * 18);
    ctx.fillText(mark, 980, 195 + idx * 18);
  });

  // Emergency exit doors & life vest station symbols
  ctx.fillStyle = "#16a34a";
  ctx.fillRect(490, 80, 18, 36);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 8px sans-serif";
  ctx.fillText("EXIT", 492, 100);

  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

// 4D. Marine Reinforced Concrete Wharf with Weathering & Hazard Stripes (512x512)
function createWharfConcreteTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // Marine concrete base tone
  ctx.fillStyle = "#8a94a0";
  ctx.fillRect(0, 0, 512, 512);

  // Concrete noise & aggregate speckling
  for (let i = 0; i < 4000; i++) {
    const nx = Math.random() * 512;
    const ny = Math.random() * 512;
    const tone = Math.random() > 0.5 ? 255 : 0;
    const alpha = Math.random() * 0.12;
    ctx.fillStyle = `rgba(${tone}, ${tone}, ${tone}, ${alpha})`;
    ctx.fillRect(nx, ny, 2.5, 2.5);
  }

  // Expansion joint grid
  ctx.strokeStyle = "rgba(30, 41, 59, 0.4)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(256, 0);
  ctx.lineTo(256, 512);
  ctx.moveTo(0, 256);
  ctx.lineTo(512, 256);
  ctx.stroke();

  // Yellow & Black Diagonal Hazard Curb Stripes along docking edge
  const stripeWidth = 28;
  for (let x = -50; x < 560; x += stripeWidth * 2) {
    ctx.fillStyle = "#eab308";
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + stripeWidth, 0);
    ctx.lineTo(x + stripeWidth - 25, 45);
    ctx.lineTo(x - 25, 45);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#1e293b";
    ctx.beginPath();
    ctx.moveTo(x + stripeWidth, 0);
    ctx.lineTo(x + stripeWidth * 2, 0);
    ctx.lineTo(x + stripeWidth * 2 - 25, 45);
    ctx.lineTo(x + stripeWidth - 25, 45);
    ctx.closePath();
    ctx.fill();
  }

  // Tidal algae & salt water drip stains at bottom
  const algaeGrad = ctx.createLinearGradient(0, 380, 0, 512);
  algaeGrad.addColorStop(0, "rgba(22, 101, 52, 0)");
  algaeGrad.addColorStop(0.6, "rgba(22, 101, 52, 0.45)");
  algaeGrad.addColorStop(1, "rgba(20, 83, 45, 0.85)");
  ctx.fillStyle = algaeGrad;
  ctx.fillRect(0, 380, 512, 132);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// 5. Palawan Fine Sand Seabed with Animated Light Caustics
function createCausticTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);

  ctx.fillStyle = "#f6eee0";
  ctx.fillRect(0, 0, 512, 512);

  ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
  ctx.lineWidth = 2.5;

  for (let i = 0; i < 35; i++) {
    ctx.beginPath();
    let cx = 0;
    let cy = i * 16;
    ctx.moveTo(cx, cy);
    while (cx < 512) {
      cx += 24;
      cy += Math.sin(cx * 0.05 + i) * 6;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }

  for (let j = 0; j < 35; j++) {
    ctx.beginPath();
    let cx = j * 16;
    let cy = 0;
    ctx.moveTo(cx, cy);
    while (cy < 512) {
      cy += 24;
      cx += Math.cos(cy * 0.05 + j) * 6;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// 6. Traditional Philippine Sailing Paraw Multi-Colored Layag Sail Texture (512x512)
function createParawSailTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // Woven sailcloth off-white base
  ctx.fillStyle = "#fafaf9";
  ctx.fillRect(0, 0, 512, 512);

  // Fine fabric weave
  ctx.fillStyle = "rgba(0, 0, 0, 0.03)";
  for (let y = 0; y < 512; y += 4) {
    ctx.fillRect(0, y, 512, 1);
  }
  for (let x = 0; x < 512; x += 4) {
    ctx.fillRect(x, 0, 1, 512);
  }

  // Dynamic sweeping regatta bands (Turquoise, Yellow, Scarlet, Royal Navy)
  const bands = [
    { color: "#06b6d4", startY: 40, endY: 130 },
    { color: "#facc15", startY: 140, endY: 220 },
    { color: "#dc2626", startY: 230, endY: 340 },
    { color: "#1e40af", startY: 350, endY: 460 },
  ];

  bands.forEach((b) => {
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.moveTo(0, b.startY);
    ctx.bezierCurveTo(180, b.startY + 30, 340, b.startY - 20, 512, b.startY + 40);
    ctx.lineTo(512, b.endY + 40);
    ctx.bezierCurveTo(340, b.endY - 20, 180, b.endY + 30, 0, b.endY);
    ctx.closePath();
    ctx.fill();
  });

  // Philippine 8-Ray Golden Sun Emblem on center of sail
  ctx.fillStyle = "#fef08a";
  ctx.beginPath();
  ctx.arc(256, 280, 42, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#eab308";
  ctx.lineWidth = 4;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(256 + Math.cos(angle) * 44, 280 + Math.sin(angle) * 44);
    ctx.lineTo(256 + Math.cos(angle) * 72, 280 + Math.sin(angle) * 72);
    ctx.stroke();
  }

  // Double sail stitching reinforcement lines
  ctx.strokeStyle = "rgba(15, 23, 42, 0.25)";
  ctx.lineWidth = 2;
  [135, 225, 345].forEach((sy) => {
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(512, sy + 40);
    ctx.stroke();
  });

  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

// 7. Engraved Satin Brass Plaque Texture (512x128)
function createPlaqueTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // Brushed satin brass gradient
  const grad = ctx.createLinearGradient(0, 0, 512, 128);
  grad.addColorStop(0, "#b48c28");
  grad.addColorStop(0.3, "#fef08a");
  grad.addColorStop(0.5, "#d4af37");
  grad.addColorStop(0.8, "#fef08a");
  grad.addColorStop(1, "#99731e");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 128);

  // Subtle metallic brush strokes
  ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
  for (let i = 0; i < 60; i++) {
    ctx.fillRect(0, Math.random() * 128, 512, 1.2);
  }

  // Beveled border
  ctx.strokeStyle = "#5a4312";
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, 500, 116);
  ctx.strokeStyle = "rgba(254, 240, 138, 0.8)";
  ctx.lineWidth = 2;
  ctx.strokeRect(10, 10, 492, 108);

  // Corner rivets
  const rivets = [
    [16, 16],
    [496, 16],
    [16, 112],
    [496, 112],
  ];
  ctx.fillStyle = "#3a2b0c";
  rivets.forEach(([rx, ry]) => {
    ctx.beginPath();
    ctx.arc(rx, ry, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  // Engraved Text with shadow effect
  ctx.textAlign = "center";

  // Line 1: PANTALAN DIORAMA
  ctx.font = "bold 20px 'Times New Roman', serif";
  ctx.fillStyle = "rgba(58, 43, 12, 0.4)";
  ctx.fillText("PHILIPPINE PANTALAN JELLY", 257, 51);
  ctx.fillStyle = "#2c2009";
  ctx.fillText("PHILIPPINE PANTALAN JELLY", 256, 50);

  // Line 2: ENGINEERED BY DYLAN RAMOS
  ctx.font = "bold 25px 'Courier New', monospace";
  ctx.fillStyle = "rgba(254, 240, 138, 0.35)";
  ctx.fillText("ENGINEERED BY DYLAN RAMOS", 257, 89);
  ctx.fillStyle = "#1e1505";
  ctx.fillText("ENGINEERED BY DYLAN RAMOS", 256, 88);

  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

// 8. Authentic Philippine Coconut Palm Ringed Bark Texture (512x512)
function createPalmBarkTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // Weathered brownish-gray coconut palm trunk
  const grad = ctx.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, "#4a3c2c");
  grad.addColorStop(0.3, "#6b5844");
  grad.addColorStop(0.7, "#584735");
  grad.addColorStop(1, "#443526");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  // Vertical fibrous striations
  ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
  for (let i = 0; i < 180; i++) {
    const x = Math.random() * 512;
    ctx.fillRect(x, 0, 1.5, 512);
  }
  ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
  for (let i = 0; i < 180; i++) {
    const x = Math.random() * 512;
    ctx.fillRect(x, 0, 2.0, 512);
  }

  // Characteristic leaf-scar horizontal rings
  for (let y = 0; y < 512; y += 32) {
    // Shadow groove
    ctx.fillStyle = "rgba(18, 12, 6, 0.65)";
    ctx.fillRect(0, y, 512, 3.5);
    // Ridge highlight
    ctx.fillStyle = "rgba(180, 155, 125, 0.4)";
    ctx.fillRect(0, y + 3.5, 512, 2.5);

    // Weathered notch imperfections
    for (let k = 0; k < 6; k++) {
      const kx = Math.random() * 512;
      ctx.fillStyle = "rgba(25, 18, 10, 0.5)";
      ctx.fillRect(kx, y - 2, 14, 7);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// 9. Authentic Pinnate Coconut Palm Frond Leaflet Texture with Alpha (512x256)
function createPalmFrondTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // Clear transparent background so gaps between leaflets are 100% see-through
  ctx.clearRect(0, 0, 512, 256);

  const cy = 128;

  // Draw individual feather-like pinnate leaflets fanning outward
  for (let x = 16; x < 500; x += 4.5) {
    const t = x / 512;
    // Length of leaflets: starts short, widens in middle, tapers at tip
    const maxLen = 110 * Math.sin(t * Math.PI * 0.95);
    if (maxLen < 4) continue;

    // Angle of leaflets sweeps back towards tip
    const sweep = 18 + t * 26;

    // Upper leaflet
    const gradU = ctx.createLinearGradient(x, cy, x + sweep, cy - maxLen);
    gradU.addColorStop(0, "#15803d");
    gradU.addColorStop(0.5, "#22c55e");
    gradU.addColorStop(1, t > 0.82 ? "#eab308" : "#86efac");

    ctx.strokeStyle = gradU;
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(x, cy);
    ctx.lineTo(x + sweep, cy - maxLen);
    ctx.stroke();

    // Lower leaflet
    const gradD = ctx.createLinearGradient(x, cy, x + sweep, cy + maxLen);
    gradD.addColorStop(0, "#166534");
    gradD.addColorStop(0.5, "#16a34a");
    gradD.addColorStop(1, t > 0.82 ? "#ca8a04" : "#4ade80");

    ctx.strokeStyle = gradD;
    ctx.beginPath();
    ctx.moveTo(x, cy);
    ctx.lineTo(x + sweep, cy + maxLen);
    ctx.stroke();
  }

  // Central thick fibrous rachis (spine)
  const spineGrad = ctx.createLinearGradient(0, cy, 512, cy);
  spineGrad.addColorStop(0, "#ca8a04");
  spineGrad.addColorStop(0.2, "#65a30d");
  spineGrad.addColorStop(0.8, "#15803d");
  spineGrad.addColorStop(1, "#84cc16");

  ctx.strokeStyle = spineGrad;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(0, cy);
  ctx.lineTo(512, cy);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

// Procedural 3D Arched Frond Geometry with V-Gutter Spine and Gravity Droop
function createCurvedFrondGeometry(length: number, maxWidth: number, droop: number): THREE.BufferGeometry {
  const segments = 16;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const z = t * length;
    const y = Math.sin(t * Math.PI * 0.7) * (length * 0.22) - Math.pow(t, 2.2) * droop;
    const w = Math.sin(t * Math.PI) * maxWidth * 0.5;

    const gutterY = y + 0.02 * (1 - t);
    const edgeY = y - 0.04 * (1 - t);

    // Left vertex (-X)
    positions.push(-w, edgeY, z);
    uvs.push(t, 0.0);

    // Center spine vertex (X = 0)
    positions.push(0, gutterY, z);
    uvs.push(t, 0.5);

    // Right vertex (+X)
    positions.push(w, edgeY, z);
    uvs.push(t, 1.0);
  }

  for (let i = 0; i < segments; i++) {
    const row1 = i * 3;
    const row2 = (i + 1) * 3;

    // Left quad
    indices.push(row1, row2, row1 + 1);
    indices.push(row1 + 1, row2, row2 + 1);

    // Right quad
    indices.push(row1 + 1, row2 + 1, row1 + 2);
    indices.push(row1 + 2, row2 + 1, row2 + 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// Procedural Organically Curved Segmented Trunk with Flared Root Base & Ring Scars
function createCurvedPalmTrunk(
  height: number,
  leanAngleX: number,
  leanAngleZ: number,
  barkMat: THREE.Material
): { trunkGroup: THREE.Group; crownPosition: THREE.Vector3 } {
  const trunkGroup = new THREE.Group();
  const segments = 10;
  const currentPos = new THREE.Vector3(0, 0, 0);
  const crownPosition = new THREE.Vector3();

  // Flared bulbous root collar at the base
  const rootCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.14, 12), barkMat);
  rootCollar.position.y = 0.07;
  trunkGroup.add(rootCollar);

  const ringMat = new THREE.MeshStandardMaterial({ color: "#2d2015", roughness: 0.9 });

  for (let i = 0; i < segments; i++) {
    const t = i / segments;
    const nextT = (i + 1) / segments;

    const rBottom = THREE.MathUtils.lerp(0.075, 0.042, t);
    const rTop = THREE.MathUtils.lerp(0.075, 0.042, nextT);
    const segHeight = height / segments;

    const segGeo = new THREE.CylinderGeometry(rTop, rBottom, segHeight, 10);
    const segMesh = new THREE.Mesh(segGeo, barkMat);
    segMesh.castShadow = true;
    segMesh.receiveShadow = true;

    const swayX = Math.sin(t * Math.PI * 0.8) * leanAngleX;
    const swayZ = Math.sin(t * Math.PI * 0.7) * leanAngleZ;

    segMesh.position.set(currentPos.x + swayX * 0.06, currentPos.y + segHeight * 0.5, currentPos.z + swayZ * 0.06);
    segMesh.rotation.z = -leanAngleX * (0.15 + t * 0.35);
    segMesh.rotation.x = leanAngleZ * (0.15 + t * 0.35);
    trunkGroup.add(segMesh);

    // Leaf scar ring at junction
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rBottom * 1.05, 0.008, 6, 12), ringMat);
    ring.rotation.x = Math.PI * 0.5;
    ring.position.set(currentPos.x + swayX * 0.06, currentPos.y, currentPos.z + swayZ * 0.06);
    trunkGroup.add(ring);

    currentPos.set(
      segMesh.position.x + Math.sin(segMesh.rotation.z) * segHeight * 0.5,
      segMesh.position.y + segHeight * 0.5,
      segMesh.position.z + Math.sin(segMesh.rotation.x) * segHeight * 0.5
    );
  }

  crownPosition.copy(currentPos);
  return { trunkGroup, crownPosition };
}

// Full Realistic Coconut Palm Tree Assembler
function createRealisticPalmTree(
  height: number,
  leanX: number,
  leanZ: number,
  barkMat: THREE.Material,
  frondMat: THREE.Material,
  coconutMat: THREE.Material
): { group: THREE.Group; fronds: THREE.Mesh[] } {
  const treeGroup = new THREE.Group();
  const { trunkGroup, crownPosition } = createCurvedPalmTrunk(height, leanX, leanZ, barkMat);
  treeGroup.add(trunkGroup);

  const crownGroup = new THREE.Group();
  crownGroup.position.copy(crownPosition);
  treeGroup.add(crownGroup);

  // Brown fibrous coir collar at crown base
  const coirMat = new THREE.MeshStandardMaterial({ color: "#54381e", roughness: 0.95 });
  const crownCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.045, 0.16, 8), coirMat);
  crownCollar.position.y = 0.05;
  crownGroup.add(crownCollar);

  // Coconut clusters (7 realistic coconuts clustered under fronds)
  const calyxMat = new THREE.MeshStandardMaterial({ color: "#223812", roughness: 0.8 });
  for (let c = 0; c < 7; c++) {
    const nutGroup = new THREE.Group();
    const cAngle = (c / 7) * Math.PI * 2 + (c % 2) * 0.25;
    const cRadius = 0.065 + (c % 2) * 0.025;

    const nut = new THREE.Mesh(new THREE.SphereGeometry(0.042, 8, 8), coconutMat);
    nut.scale.set(0.85, 1.25, 0.85);
    nutGroup.add(nut);

    const calyx = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.024, 0.018, 6), calyxMat);
    calyx.position.y = 0.048;
    nutGroup.add(calyx);

    nutGroup.position.set(Math.cos(cAngle) * cRadius, -0.02 - (c % 3) * 0.025, Math.sin(cAngle) * cRadius);
    nutGroup.rotation.x = Math.sin(cAngle) * 0.4;
    nutGroup.rotation.z = Math.cos(cAngle) * 0.4;
    crownGroup.add(nutGroup);
  }

  // 16 Curved Fronds in 3 concentric tiers
  const frondMeshes: THREE.Mesh[] = [];

  // Tier 1: 5 young upright fronds (length 1.15m)
  const tier1Geo = createCurvedFrondGeometry(1.15, 0.36, 0.38);
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + 0.15;
    const frond = new THREE.Mesh(tier1Geo, frondMat);
    frond.castShadow = true;
    frond.rotation.y = angle;
    frond.rotation.x = -0.42;
    frond.position.set(0, 0.08, 0);
    crownGroup.add(frond);
    frondMeshes.push(frond);
  }

  // Tier 2: 6 mature spreading fronds (length 1.38m)
  const tier2Geo = createCurvedFrondGeometry(1.38, 0.42, 0.58);
  for (let j = 0; j < 6; j++) {
    const angle = (j / 6) * Math.PI * 2 + 0.55;
    const frond = new THREE.Mesh(tier2Geo, frondMat);
    frond.castShadow = true;
    frond.rotation.y = angle;
    frond.rotation.x = -0.72;
    frond.position.set(0, 0.04, 0);
    crownGroup.add(frond);
    frondMeshes.push(frond);
  }

  // Tier 3: 5 lower hanging older fronds (length 1.25m)
  const tier3Geo = createCurvedFrondGeometry(1.25, 0.38, 0.72);
  for (let k = 0; k < 5; k++) {
    const angle = (k / 5) * Math.PI * 2 + 0.95;
    const frond = new THREE.Mesh(tier3Geo, frondMat);
    frond.castShadow = true;
    frond.rotation.y = angle;
    frond.rotation.x = -1.05;
    frond.position.set(0, 0.01, 0);
    crownGroup.add(frond);
    frondMeshes.push(frond);
  }

  return { group: treeGroup, fronds: frondMeshes };
}

// --- COMPONENT ENTRYPOINT ---

export default function HarborJelly() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // UI state
  const [isSunset, setIsSunset] = useState<boolean>(false);
  const [fps, setFps] = useState<number>(60);
  const [jellyEnergy, setJellyEnergy] = useState<number>(0);
  const [activePreset, setActivePreset] = useState<CameraPreset>("overview");

  // Interaction refs
  const pokeTriggerRef = useRef<(() => void) | null>(null);
  const toggleSunsetRef = useRef<(() => void) | null>(null);
  const setPresetRef = useRef<((preset: CameraPreset) => void) | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // --- SCENE & RENDERER SETUP ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#081224");

    const camera = new THREE.PerspectiveCamera(
      42,
      container.clientWidth / container.clientHeight,
      0.1,
      60
    );
    camera.position.set(11.8, 9.4, 12.0);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
      alpha: false,
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.055;
    controls.target.set(0, 1.8, 0);
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = 4.2;
    controls.maxDistance = 32.0;

    // Camera preset transitions (Wide Panoramic Archipelago)
    const targetCamPos = new THREE.Vector3().copy(camera.position);
    const targetLookAt = new THREE.Vector3().copy(controls.target);

    setPresetRef.current = (preset: CameraPreset) => {
      setActivePreset(preset);
      if (preset === "overview") {
        targetCamPos.set(11.8, 9.4, 12.0);
        targetLookAt.set(0, 1.8, 0);
      } else if (preset === "pier") {
        targetCamPos.set(-4.5, 5.4, 3.8);
        targetLookAt.set(-2.8, 3.6, 0.2);
      } else if (preset === "reef") {
        targetCamPos.set(2.6, 2.0, 3.6);
        targetLookAt.set(0.6, 0.8, 0.4);
      } else if (preset === "parola") {
        targetCamPos.set(5.8, 6.8, -0.6);
        targetLookAt.set(3.1, 4.8, -1.6);
      } else if (preset === "sandbar") {
        targetCamPos.set(5.2, 4.8, 2.8);
        targetLookAt.set(3.2, 3.5, 0.6);
      }
    };

    // PMREM Environment
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    const roomEnv = new RoomEnvironment();
    scene.environment = pmremGenerator.fromScene(roomEnv).texture;

    // --- PROCEDURAL ATMOSPHERIC SKY DOME ---
    const skyGeo = new THREE.SphereGeometry(35, 32, 16);
    skyGeo.scale(-1, 1, 1);
    const skyMat = new THREE.MeshBasicMaterial({
      color: "#081224",
      side: THREE.BackSide,
    });
    const skyDome = new THREE.Mesh(skyGeo, skyMat);
    scene.add(skyDome);

    // --- PROCEDURAL LIGHTING RIG (Cinematic Archipelago Lighting) ---
    const ambientLight = new THREE.AmbientLight("#cffafe", 0.65);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight("#fffbeb", 2.6);
    sunLight.position.set(10.5, 14.5, 8.5);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 38;
    sunLight.shadow.camera.left = -9.0;
    sunLight.shadow.camera.right = 9.0;
    sunLight.shadow.camera.top = 7.5;
    sunLight.shadow.camera.bottom = -7.5;
    sunLight.shadow.bias = -0.00035;
    scene.add(sunLight);

    const bounceLight = new THREE.DirectionalLight("#38bdf8", 0.75);
    bounceLight.position.set(-8, 5, -8);
    scene.add(bounceLight);

    const kuboLight = new THREE.PointLight("#f59e0b", 0.45, 6.0);
    kuboLight.position.set(-2.8, 4.0, 0.2);
    scene.add(kuboLight);

    const ferryLight = new THREE.PointLight("#fbbf24", 0.4, 6.5);
    ferryLight.position.set(-0.95, 4.6, -0.3);
    scene.add(ferryLight);

    const stiltHutLight = new THREE.PointLight("#fbbf24", 0.45, 6.0);
    stiltHutLight.position.set(2.5, 4.0, 1.4);
    scene.add(stiltHutLight);

    const parolaBeacon = new THREE.PointLight("#ffedd5", 1.5, 12.0);
    parolaBeacon.position.set(3.1, 5.85, -1.6);
    scene.add(parolaBeacon);

    // --- DISPLAY PLINTH & BRASS TRIM (EXPANDED WIDE FORMAT 10.2 x 7.0) ---
    const woodTexture = createNarraWoodTexture();
    const plinthMat = new THREE.MeshStandardMaterial({
      map: woodTexture,
      roughness: 0.55,
      metalness: 0.1,
      color: "#4a2111",
    });

    const plinthGeo = new THREE.BoxGeometry(10.2, 0.4, 7.0);
    const plinthMesh = new THREE.Mesh(plinthGeo, plinthMat);
    plinthMesh.position.set(0, -0.2, 0);
    plinthMesh.receiveShadow = true;
    scene.add(plinthMesh);

    const brassMat = new THREE.MeshStandardMaterial({
      color: "#d4af37",
      metalness: 0.92,
      roughness: 0.2,
    });
    const brassTrimGeo = new THREE.BoxGeometry(9.96, 0.06, 6.76);
    const brassTrim = new THREE.Mesh(brassTrimGeo, brassMat);
    brassTrim.position.set(0, 0.01, 0);
    brassTrim.receiveShadow = true;
    scene.add(brassTrim);

    const bracketGeo = new THREE.BoxGeometry(0.32, 0.44, 0.32);
    const bracketOffsets = [
      [-4.9, -0.18, -3.3],
      [4.9, -0.18, -3.3],
      [-4.9, -0.18, 3.3],
      [4.9, -0.18, 3.3],
    ];
    bracketOffsets.forEach(([bx, by, bz]) => {
      const bracket = new THREE.Mesh(bracketGeo, brassMat);
      bracket.position.set(bx, by, bz);
      scene.add(bracket);
    });

    // Satin Brass Commemorative Plaque (Front Face of Narra Plinth)
    const plaqueTexture = createPlaqueTexture();
    const plaqueMat = new THREE.MeshStandardMaterial({
      map: plaqueTexture,
      metalness: 0.85,
      roughness: 0.25,
    });
    const plaqueMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.28), plaqueMat);
    plaqueMesh.position.set(0, -0.2, 3.51);
    scene.add(plaqueMesh);

    // --- TRANSLUCENT TROPICAL SEA JELLY BLOCK (PANORAMIC WIDE FORMAT 9.6 x 3.4 x 6.4) ---
    const jellyGeo = createSmoothRoundedBoxGeometry(9.6, 3.4, 6.4, 0.25, 64);

    const jellyUniforms: JellyUniforms = {
      uTime: { value: 0 },
      uWobbleX: { value: 0 },
      uWobbleZ: { value: 0 },
      uPokePos: { value: new THREE.Vector3(0, 3.4, 0) },
      uPokeAmp: { value: 0 },
      uPokeTime: { value: 99 },
    };

    const jellyMat = new THREE.MeshPhysicalMaterial({
      transmission: 0.96,
      ior: 1.37,
      thickness: 4.2,
      roughness: 0.06,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
      attenuationColor: new THREE.Color("#06b6d4"),
      attenuationDistance: 3.8,
      transparent: true,
      reflectivity: 0.88,
    });

    // GLSL WebGL2 Safety: strictly uses tanX, tanY, tanZ
    jellyMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = jellyUniforms.uTime;
      shader.uniforms.uWobbleX = jellyUniforms.uWobbleX;
      shader.uniforms.uWobbleZ = jellyUniforms.uWobbleZ;
      shader.uniforms.uPokePos = jellyUniforms.uPokePos;
      shader.uniforms.uPokeAmp = jellyUniforms.uPokeAmp;
      shader.uniforms.uPokeTime = jellyUniforms.uPokeTime;

      shader.vertexShader = `
        uniform float uTime;
        uniform float uWobbleX;
        uniform float uWobbleZ;
        uniform vec3  uPokePos;
        uniform float uPokeAmp;
        uniform float uPokeTime;

        vec3 calcJellyDisp(vec3 p) {
          float h = clamp(p.y / 3.4, 0.0, 1.0);
          float w = h * h;
          float dx = uWobbleX * w;
          float dz = uWobbleZ * w;

          float swellFactor = smoothstep(1.5, 3.4, p.y);
          
          float w1 = sin((p.x * 0.7 + p.z * 0.7) * 1.3 - uTime * 2.0) * 0.042;
          float w2 = sin((p.x * -0.5 + p.z * 0.86) * 2.4 - uTime * 2.9) * 0.018;
          float w3 = sin((p.x * 0.9 - p.z * 0.4) * 4.2 - uTime * 4.4) * 0.009;
          float swell = (w1 + w2 + w3) * swellFactor;

          float dist = length(p.xz - uPokePos.xz);
          float ripple = 0.0;
          if (uPokeAmp > 0.001 && uPokeTime < 3.2) {
            ripple = uPokeAmp * sin(dist * 9.5 - uPokeTime * 14.5) * exp(-dist * 1.15) * exp(-uPokeTime * 2.1) * w;
          }
          return vec3(dx, swell + ripple, dz);
        }
        ${shader.vertexShader}
      `;

      shader.vertexShader = shader.vertexShader.replace(
        "#include <beginnormal_vertex>",
        `
        #include <beginnormal_vertex>

        vec3 p0 = position;
        vec3 d0 = calcJellyDisp(p0);
        vec3 dispPos = p0 + d0;

        vec3 vT = normalize(abs(normal.y) > 0.92 ? cross(normal, vec3(1.0, 0.0, 0.0)) : cross(normal, vec3(0.0, 1.0, 0.0)));
        vec3 vB = cross(normal, vT);

        float eps = 0.02;
        vec3 pT1 = (p0 + vT * eps) + calcJellyDisp(p0 + vT * eps);
        vec3 pT2 = (p0 + vB * eps) + calcJellyDisp(p0 + vB * eps);

        vec3 tanX = (pT1 - dispPos) / eps;
        vec3 tanY = (pT2 - dispPos) / eps;
        vec3 deformedNormal = normalize(cross(tanX, tanY));
        objectNormal = deformedNormal;
        `
      );

      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `
        #include <begin_vertex>
        transformed += calcJellyDisp(position);
        `
      );
    };

    const jellyMesh = new THREE.Mesh(jellyGeo, jellyMat);
    jellyMesh.castShadow = true;
    jellyMesh.receiveShadow = true;
    scene.add(jellyMesh);

    // --- PROCEDURAL PHILIPPINE PANTALAN SCENE OBJECTS ---

    // 1. PALAWAN WHITE SAND SEABED (Strictly bounded inside glass block, zero protrusion)
    const causticTexture = createCausticTexture();
    const seabedGeo = new THREE.PlaneGeometry(8.8, 5.6, 44, 32);
    seabedGeo.rotateX(-Math.PI * 0.5);
    const sandPos = seabedGeo.attributes.position;
    for (let i = 0; i < sandPos.count; i++) {
      const sx = sandPos.getX(i);
      const sz = sandPos.getZ(i);
      // Smooth inward falloff and elliptical clamping so edges taper down safely without clipping through wide glass fillets
      const nx = sx / 4.3;
      const nz = sz / 2.7;
      const distFromCenter = Math.hypot(nx, nz);
      if (distFromCenter > 0.96) {
        const factor = 0.96 / distFromCenter;
        sandPos.setX(i, sx * factor);
        sandPos.setZ(i, sz * factor);
      }
      const edgeWeight = Math.max(0, 1 - Math.pow(Math.min(distFromCenter, 0.96) / 0.92, 3));
      const sy = (Math.sin(sx * 1.1) * Math.cos(sz * 1.2) * 0.06 + 0.08) * edgeWeight + 0.02;
      sandPos.setY(i, sy);
    }
    seabedGeo.computeVertexNormals();

    const seabedMat = new THREE.MeshStandardMaterial({
      map: causticTexture,
      roughness: 0.88,
      metalness: 0.04,
      color: "#f6eee0",
    });
    const seabed = new THREE.Mesh(seabedGeo, seabedMat);
    seabed.position.set(0, 0.02, 0);
    seabed.receiveShadow = true;
    scene.add(seabed);

    // 2. DELICATE AUTHENTIC CORAL REEF (NO bulky clunky balls/sticks)
    const reefGroup = new THREE.Group();
    scene.add(reefGroup);

    // Natural warm coral palette (terracotta, deep amber, soft lavender, mint, golden)
    const coralPalette = ["#ea580c", "#d97706", "#c084fc", "#10b981", "#fbbf24", "#38bdf8"];

    // A. Multi-tiered Acropora Table Corals
    const tableCoords = [
      { x: 0.9, z: 0.4, r: 0.32, color: "#ea580c" },
      { x: 1.4, z: 0.8, r: 0.26, color: "#d97706" },
      { x: 0.4, z: 1.4, r: 0.28, color: "#c084fc" },
      { x: -0.2, z: 1.7, r: 0.22, color: "#10b981" },
    ];

    tableCoords.forEach((tc) => {
      const stemMat = new THREE.MeshStandardMaterial({ color: "#78716c", roughness: 0.85 });
      const plateMat = new THREE.MeshStandardMaterial({ color: tc.color, roughness: 0.65 });

      // Stem
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.07, 0.25, 8), stemMat);
      stem.position.set(tc.x, 0.15, tc.z);
      reefGroup.add(stem);

      // Tiered plates
      const plate1 = new THREE.Mesh(new THREE.CylinderGeometry(tc.r, tc.r * 0.8, 0.035, 12), plateMat);
      plate1.position.set(tc.x, 0.26, tc.z);
      plate1.rotation.set((Math.random() - 0.5) * 0.2, Math.random() * Math.PI, (Math.random() - 0.5) * 0.2);
      reefGroup.add(plate1);

      const plate2 = new THREE.Mesh(new THREE.CylinderGeometry(tc.r * 0.65, tc.r * 0.5, 0.03, 10), plateMat);
      plate2.position.set(tc.x + 0.06, 0.34, tc.z + 0.04);
      reefGroup.add(plate2);
    });

    // B. Delicate Branching Staghorn Antlers (Forking branches)
    const staghornSpots = [
      { x: 1.5, z: 0.1 },
      { x: 1.2, z: 1.3 },
      { x: 0.1, z: 1.1 },
      { x: -0.4, z: 0.7 },
      { x: 0.6, z: -0.4 },
    ];

    staghornSpots.forEach((spot, idx) => {
      const sGroup = new THREE.Group();
      sGroup.position.set(spot.x, 0.08, spot.z);
      const branchColor = coralPalette[idx % coralPalette.length];
      const branchMat = new THREE.MeshStandardMaterial({ color: branchColor, roughness: 0.7 });

      for (let b = 0; b < 5; b++) {
        const angle = (b / 5) * Math.PI * 2;
        const mainBranch = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.032, 0.36, 6), branchMat);
        mainBranch.position.set(Math.cos(angle) * 0.08, 0.16, Math.sin(angle) * 0.08);
        mainBranch.rotation.set(Math.sin(angle) * 0.45, angle, Math.cos(angle) * 0.45);
        sGroup.add(mainBranch);

        // Sub fork
        const subFork = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.016, 0.18, 5), branchMat);
        subFork.position.set(Math.cos(angle) * 0.12, 0.32, Math.sin(angle) * 0.12);
        subFork.rotation.set(Math.sin(angle) * 0.7, angle, Math.cos(angle) * 0.7);
        sGroup.add(subFork);
      }
      reefGroup.add(sGroup);
    });

    // C. Giant Clam (Taklobo) with fluted scalloped shell and glowing electric-cyan mantle
    const clamGroup = new THREE.Group();
    clamGroup.position.set(0.75, 0.18, 0.85);
    clamGroup.rotation.y = -0.55;

    const clamShellMat = new THREE.MeshStandardMaterial({
      color: "#f1f5f9",
      roughness: 0.65,
    });
    const mantleMat = new THREE.MeshStandardMaterial({
      color: "#00f5ff",
      emissive: "#0891b2",
      emissiveIntensity: 0.45,
      roughness: 0.22,
    });

    const bottomShell = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 16, 12, 0, Math.PI, 0, Math.PI * 0.5),
      clamShellMat
    );
    bottomShell.rotation.x = Math.PI;
    clamGroup.add(bottomShell);

    const topShell = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 16, 12, 0, Math.PI, 0, Math.PI * 0.5),
      clamShellMat
    );
    topShell.rotation.x = Math.PI - 0.58;
    clamGroup.add(topShell);

    const mantle = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.038, 14), mantleMat);
    mantle.position.set(0, 0.02, 0.04);
    clamGroup.add(mantle);

    const siphonMat = new THREE.MeshBasicMaterial({ color: "#042f2e" });
    const siphon1 = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.042, 8), siphonMat);
    siphon1.position.set(-0.05, 0.03, 0.04);
    clamGroup.add(siphon1);

    const siphon2 = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.042, 8), siphonMat);
    siphon2.position.set(0.05, 0.03, 0.04);
    clamGroup.add(siphon2);

    reefGroup.add(clamGroup);

    // 3. SWAYING TROPICAL SEAGRASS (Natural Palawan Lagoon Flora)
    const seagrassList: SeagrassData[] = [];
    const grassMat = new THREE.MeshStandardMaterial({
      color: "#16a34a",
      roughness: 0.55,
      side: THREE.DoubleSide,
    });
    const grassGeo = new THREE.PlaneGeometry(0.035, 0.52);
    grassGeo.translate(0, 0.26, 0);

    for (let g = 0; g < 36; g++) {
      const gx = -0.4 + (Math.random() - 0.5) * 3.2;
      const gz = -0.3 + (Math.random() - 0.5) * 3.2;
      const blade = new THREE.Mesh(grassGeo, grassMat);
      blade.position.set(gx, 0.12, gz);
      blade.rotation.y = Math.random() * Math.PI;
      reefGroup.add(blade);
      seagrassList.push({
        mesh: blade,
        baseRotationZ: (Math.random() - 0.5) * 0.2,
        freq: 2.1 + Math.random() * 1.4,
        phase: Math.random() * Math.PI * 2,
        swayAmp: 0.14 + Math.random() * 0.08,
      });
    }

    // 4. RISING MICRO-BUBBLES
    const bubbles: BubbleData[] = [];
    const bubbleMat = new THREE.MeshPhysicalMaterial({
      color: "#ffffff",
      transmission: 0.92,
      roughness: 0.08,
      ior: 1.12,
    });
    const bubbleGeo = new THREE.SphereGeometry(0.024, 8, 8);
    for (let b = 0; b < 26; b++) {
      const bubble = new THREE.Mesh(bubbleGeo, bubbleMat);
      const startX = (Math.random() - 0.5) * 4.0;
      const startZ = (Math.random() - 0.5) * 4.0;
      const startY = 0.25 + Math.random() * 2.8;
      bubble.position.set(startX, startY, startZ);
      scene.add(bubble);
      bubbles.push({
        mesh: bubble,
        speed: 0.38 + Math.random() * 0.42,
        resetY: 0.22,
        maxY: 3.32,
        wobbleSpeed: 2.6 + Math.random() * 2.0,
        wobbleOffset: Math.random() * Math.PI * 2,
      });
    }

    // 5. SCHOOL OF TROPICAL REEF FISH
    const fishList: FishData[] = [];
    const fishConfigs = [
      { body: "#f97316", stripe: "#ffffff", name: "clownfish" },
      { body: "#facc15", stripe: "#0f172a", name: "moorish" },
      { body: "#06b6d4", stripe: "#2563eb", name: "damselfish" },
    ];

    for (let f = 0; f < 12; f++) {
      const cfg = fishConfigs[f % fishConfigs.length];
      const fishGroup = new THREE.Group();

      const fMat = new THREE.MeshStandardMaterial({ color: cfg.body, roughness: 0.35 });
      const fStripeMat = new THREE.MeshStandardMaterial({ color: cfg.stripe, roughness: 0.35 });

      const body = new THREE.Mesh(new THREE.ConeGeometry(0.044, 0.18, 8), fMat);
      body.rotation.z = Math.PI * 0.5;
      fishGroup.add(body);

      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 8), fStripeMat);
      band.rotation.z = Math.PI * 0.5;
      band.position.x = -0.02;
      fishGroup.add(band);

      const finGeo = new THREE.PlaneGeometry(0.038, 0.065);
      finGeo.translate(0, 0, 0.032);

      const finL = new THREE.Mesh(finGeo, fMat);
      finL.position.set(0.04, 0, 0.04);
      finL.rotation.y = 0.5;
      fishGroup.add(finL);

      const finR = new THREE.Mesh(finGeo, fMat);
      finR.position.set(0.04, 0, -0.04);
      finR.rotation.y = -0.5;
      fishGroup.add(finR);

      const tail = new THREE.Mesh(new THREE.BufferGeometry(), fMat);
      const tailVertices = new Float32Array([
        -0.085, 0, 0,
        -0.155, 0.052, 0,
        -0.155, -0.052, 0,
      ]);
      tail.geometry.setAttribute("position", new THREE.BufferAttribute(tailVertices, 3));
      tail.geometry.computeVertexNormals();
      fishGroup.add(tail);

      scene.add(fishGroup);

      fishList.push({
        group: fishGroup,
        tail,
        finL,
        finR,
        orbitRadius: 1.1 + Math.random() * 1.5,
        speed: 0.55 + Math.random() * 0.45,
        angle: (f / 12) * Math.PI * 2,
        baseY: 0.85 + Math.random() * 1.8,
        swimFreq: 9.5 + Math.random() * 3.0,
        phase: Math.random() * Math.PI * 2,
        verticalAmp: 0.08 + Math.random() * 0.08,
      });
    }

    // 6. SEA TURTLE (PAWIKAN)
    const pawikan = new THREE.Group();
    const carapaceMat = new THREE.MeshStandardMaterial({ color: "#5b4a36", roughness: 0.58 });
    const plastronMat = new THREE.MeshStandardMaterial({ color: "#fef08a", roughness: 0.5 });
    const turtleSkinMat = new THREE.MeshStandardMaterial({ color: "#47553f", roughness: 0.52 });

    const carapace = new THREE.Mesh(new THREE.SphereGeometry(0.25, 14, 10), carapaceMat);
    carapace.scale.set(1.35, 0.48, 0.98);
    pawikan.add(carapace);

    const plastron = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), plastronMat);
    plastron.scale.set(1.22, 0.36, 0.9);
    plastron.position.y = -0.05;
    pawikan.add(plastron);

    const tHead = new THREE.Mesh(new THREE.SphereGeometry(0.082, 10, 8), turtleSkinMat);
    tHead.position.set(0.35, 0.02, 0);
    tHead.scale.set(1.2, 0.9, 0.9);
    pawikan.add(tHead);

    const eyeMat = new THREE.MeshBasicMaterial({ color: "#0f172a" });
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 6), eyeMat);
    eyeL.position.set(0.41, 0.05, 0.05);
    pawikan.add(eyeL);

    const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 6), eyeMat);
    eyeR.position.set(0.41, 0.05, -0.05);
    pawikan.add(eyeR);

    const flipperGeo = new THREE.BoxGeometry(0.25, 0.02, 0.1);
    flipperGeo.translate(0.12, 0, 0);

    const flipperFL = new THREE.Mesh(flipperGeo, turtleSkinMat);
    flipperFL.position.set(0.18, 0, 0.2);
    flipperFL.rotation.y = 0.65;
    pawikan.add(flipperFL);

    const flipperFR = new THREE.Mesh(flipperGeo, turtleSkinMat);
    flipperFR.position.set(0.18, 0, -0.2);
    flipperFR.rotation.y = -0.65;
    pawikan.add(flipperFR);

    const rearFlipperGeo = new THREE.BoxGeometry(0.11, 0.016, 0.075);
    const flipperBL = new THREE.Mesh(rearFlipperGeo, turtleSkinMat);
    flipperBL.position.set(-0.24, -0.02, 0.12);
    flipperBL.rotation.y = 0.4;
    pawikan.add(flipperBL);

    const flipperBR = new THREE.Mesh(rearFlipperGeo, turtleSkinMat);
    flipperBR.position.set(-0.24, -0.02, -0.12);
    flipperBR.rotation.y = -0.4;
    pawikan.add(flipperBR);

    pawikan.position.set(0, 1.7, 0);
    scene.add(pawikan);

    // 7. REALISTIC FILIPINO PANTALAN PIER (ANCHORED ON LEFT EDGE)
    const pierPlanksTexture = createPierPlanksTexture();
    const wharfConcreteTexture = createWharfConcreteTexture();
    const ferryTexture = createFerryTexture();

    // High-Fidelity Philippine Coconut Palm Materials & Foliage Rig
    const palmBarkTexture = createPalmBarkTexture();
    const palmFrondTexture = createPalmFrondTexture();
    const palmBarkMat = new THREE.MeshStandardMaterial({
      map: palmBarkTexture,
      roughness: 0.85,
      metalness: 0.05,
    });
    const palmFrondMat = new THREE.MeshStandardMaterial({
      map: palmFrondTexture,
      transparent: true,
      alphaTest: 0.32,
      roughness: 0.42,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    const palmCoconutMat = new THREE.MeshStandardMaterial({
      color: "#2e4a18",
      roughness: 0.6,
      metalness: 0.05,
    });
    const allPalmFronds: THREE.Mesh[] = [];

    const pierGroup = new THREE.Group();
    pierGroup.position.set(-2.8, 3.48, 0.2);
    scene.add(pierGroup);

    // Weathered Marine Reinforced Concrete Wharf with Hazard Curb & Waterline Stains
    const wharfMat = new THREE.MeshStandardMaterial({
      map: wharfConcreteTexture,
      roughness: 0.82,
      metalness: 0.05,
    });
    const wharf = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.28, 4.0), wharfMat);
    wharf.position.set(0, -0.06, 0);
    wharf.receiveShadow = true;
    pierGroup.add(wharf);

    const plankMat = new THREE.MeshStandardMaterial({
      map: pierPlanksTexture,
      roughness: 0.78,
    });
    const boardwalk = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.14, 3.8), plankMat);
    boardwalk.position.set(0.68, 0.04, 0);
    boardwalk.receiveShadow = true;
    pierGroup.add(boardwalk);

    // Weathered timber pilings with algae waterline collars
    const stiltMat = new THREE.MeshStandardMaterial({ color: "#292017", roughness: 0.95 });
    const algaeMat = new THREE.MeshStandardMaterial({ color: "#14532d", roughness: 0.9 });

    for (let sx = -0.65; sx <= 0.95; sx += 0.52) {
      for (let sz = -1.7; sz <= 1.7; sz += 0.85) {
        const stilt = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.052, 3.6, 8), stiltMat);
        stilt.position.set(sx, -1.8, sz);
        pierGroup.add(stilt);

        const algaeRing = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.65, 8), algaeMat);
        algaeRing.position.set(sx, -0.3, sz);
        pierGroup.add(algaeRing);
      }
    }

    // Heavy-Duty Black Cylindrical Rubber Dock Fenders (hung along ship berthing edge)
    const dockFenderMat = new THREE.MeshStandardMaterial({ color: "#0f172a", roughness: 0.85 });
    const chainMat = new THREE.MeshStandardMaterial({ color: "#64748b", metalness: 0.85, roughness: 0.25 });
    [-1.4, -0.7, 0.0, 0.7, 1.4].forEach((fz) => {
      const fender = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.36, 12), dockFenderMat);
      fender.position.set(1.18, -0.06, fz);
      pierGroup.add(fender);

      [-0.12, 0.12].forEach((cz) => {
        const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.14, 6), chainMat);
        chain.position.set(1.18, 0.08, fz + cz);
        pierGroup.add(chain);
      });
    });

    // Heavy-Duty Double-Bitt Cast Iron Mooring Bollards & Coiled Ropes
    const bollardMat = new THREE.MeshStandardMaterial({ color: "#1e293b", metalness: 0.9, roughness: 0.28 });
    const ropeMat = new THREE.MeshStandardMaterial({ color: "#a16207", roughness: 0.82 });

    [-1.5, -0.5, 0.5, 1.5].forEach((bz) => {
      const bollardBase = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.22), bollardMat);
      bollardBase.position.set(1.12, 0.1, bz);
      pierGroup.add(bollardBase);

      [-0.05, 0.05].forEach((postZ) => {
        const bollardPost = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.035, 0.15, 8), bollardMat);
        bollardPost.position.set(1.12, 0.17, bz + postZ);
        pierGroup.add(bollardPost);
      });

      const ropeCoil = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.02, 6, 14), ropeMat);
      ropeCoil.rotation.x = Math.PI * 0.5;
      ropeCoil.position.set(1.12, 0.08, bz);
      pierGroup.add(ropeCoil);
    });

    // Galvanized Steel Safety Railing along wharf back drop-off (x = -0.76)
    const railingMat = new THREE.MeshStandardMaterial({ color: "#cbd5e1", metalness: 0.8, roughness: 0.22 });
    for (let rz = -1.8; rz <= 1.8; rz += 0.6) {
      const rPost = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.28, 8), railingMat);
      rPost.position.set(-0.76, 0.22, rz);
      pierGroup.add(rPost);
    }
    const topRail = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 3.65, 8), railingMat);
    topRail.rotation.x = Math.PI * 0.5;
    topRail.position.set(-0.76, 0.35, 0);
    pierGroup.add(topRail);

    const midRail = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 3.65, 8), railingMat);
    midRail.rotation.x = Math.PI * 0.5;
    midRail.position.set(-0.76, 0.22, 0);
    pierGroup.add(midRail);

    // Lifebuoy Stand with Coiled Rescue Line
    const lifebuoyStand = new THREE.Group();
    lifebuoyStand.position.set(0.92, 0.08, -1.75);
    pierGroup.add(lifebuoyStand);

    const buoyPost = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.44, 8), railingMat);
    buoyPost.position.y = 0.22;
    lifebuoyStand.add(buoyPost);

    const buoyMat = new THREE.MeshStandardMaterial({ color: "#ea580c", roughness: 0.32 });
    const buoyWhiteMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.35 });
    const buoyRing = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.02, 8, 16), buoyMat);
    buoyRing.position.set(0, 0.32, 0.02);
    lifebuoyStand.add(buoyRing);

    [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5].forEach((a) => {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.046, 0.046), buoyWhiteMat);
      strap.position.set(Math.cos(a) * 0.068, 0.32 + Math.sin(a) * 0.068, 0.02);
      lifebuoyStand.add(strap);
    });

    // Nipa-Roof Waiting Shed (Kubo)
    const kuboGroup = new THREE.Group();
    kuboGroup.position.set(-0.2, 0.1, -0.9);
    pierGroup.add(kuboGroup);

    const bambooMat = new THREE.MeshStandardMaterial({ color: "#ca8a04", roughness: 0.58 });
    const postPositions = [
      [-0.4, 0.48, -0.4],
      [0.4, 0.48, -0.4],
      [-0.4, 0.48, 0.4],
      [0.4, 0.48, 0.4],
    ];
    postPositions.forEach(([px, py, pz]) => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.96, 8), bambooMat);
      post.position.set(px, py, pz);
      kuboGroup.add(post);

      [-0.2, 0.1, 0.3].forEach((ny) => {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.005, 4, 8), bambooMat);
        ring.rotation.x = Math.PI * 0.5;
        ring.position.set(px, py + ny, pz);
        kuboGroup.add(ring);
      });
    });

    const thatchMat = new THREE.MeshStandardMaterial({ color: "#b45309", roughness: 0.96 });
    const nipaRoof = new THREE.Mesh(new THREE.ConeGeometry(0.8, 0.66, 4), thatchMat);
    nipaRoof.position.set(0, 1.2, 0);
    nipaRoof.rotation.y = Math.PI * 0.25;
    nipaRoof.castShadow = true;
    kuboGroup.add(nipaRoof);

    const bench = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.04, 0.22), bambooMat);
    bench.position.set(0, 0.2, 0);
    kuboGroup.add(bench);

    const lanternMat = new THREE.MeshStandardMaterial({
      color: "#fbbf24",
      emissive: "#f59e0b",
      emissiveIntensity: 0.85,
    });
    const kuboLantern = new THREE.Mesh(new THREE.SphereGeometry(0.048, 8, 8), lanternMat);
    kuboLantern.position.set(0, 0.86, 0);
    kuboGroup.add(kuboLantern);

    // Realistic Curved Coconut Palm Tree on Wharf
    const pierPalmData = createRealisticPalmTree(1.68, 0.35, -0.22, palmBarkMat, palmFrondMat, palmCoconutMat);
    const pierPalm = pierPalmData.group;
    pierPalm.position.set(-0.55, 0.08, 1.25);
    pierGroup.add(pierPalm);
    allPalmFronds.push(...pierPalmData.fronds);

    // Cargo Crates & Blue Water Barrels
    const crateMat = new THREE.MeshStandardMaterial({ color: "#92400e", roughness: 0.8 });
    const crate1 = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.18, 0.28), crateMat);
    crate1.position.set(0.32, 0.15, -0.3);
    pierGroup.add(crate1);

    const mangoMat = new THREE.MeshStandardMaterial({ color: "#facc15", roughness: 0.38 });
    for (let m = 0; m < 6; m++) {
      const mango = new THREE.Mesh(new THREE.SphereGeometry(0.03, 7, 7), mangoMat);
      mango.position.set(0.26 + (m % 3) * 0.042, 0.25, -0.33 + Math.floor(m / 3) * 0.05);
      pierGroup.add(mango);
    }

    const drumMat = new THREE.MeshStandardMaterial({ color: "#0284c7", roughness: 0.32 });
    [-0.1, 0.1].forEach((dz) => {
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.32, 12), drumMat);
      drum.position.set(-0.55, 0.18, 0.25 + dz * 1.5);
      pierGroup.add(drum);
    });

    // Coastal Crane
    const craneGroup = new THREE.Group();
    craneGroup.position.set(0.42, 0.1, 0.95);
    pierGroup.add(craneGroup);

    const craneMat = new THREE.MeshStandardMaterial({ color: "#f59e0b", roughness: 0.42 });
    const craneMast = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.95, 0.07), craneMat);
    craneMast.position.y = 0.48;
    craneGroup.add(craneMast);

    const craneJib = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.05, 0.05), craneMat);
    craneJib.position.set(0.24, 0.9, 0);
    craneGroup.add(craneJib);

    const cableMat = new THREE.MeshBasicMaterial({ color: "#0f172a" });
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.48), cableMat);
    cable.position.set(0.45, 0.65, 0);
    craneGroup.add(cable);

    const palette = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.04, 0.19), crateMat);
    palette.position.set(0.45, 0.4, 0);
    craneGroup.add(palette);

    // Fiesta Banderitas
    const banderitasColors = ["#ef4444", "#eab308", "#06b6d4", "#ec4899", "#22c55e"];
    for (let p = 0; p < 14; p++) {
      const t = p / 13;
      const bz = -1.45 + t * 2.9;
      const sag = Math.sin(t * Math.PI) * 0.19;
      const pennantMat = new THREE.MeshBasicMaterial({
        color: banderitasColors[p % banderitasColors.length],
        side: THREE.DoubleSide,
      });
      const pennant = new THREE.Mesh(new THREE.BufferGeometry(), pennantMat);
      const pv = new Float32Array([
        0, 0, 0,
        0, -0.09, 0.042,
        0, 0, 0.085,
      ]);
      pennant.geometry.setAttribute("position", new THREE.BufferAttribute(pv, 3));
      pennant.position.set(0.85, 0.98 - sag, bz);
      pierGroup.add(pennant);
    }

    // 8. MINIATURE AUTHENTIC PHILIPPINE JEEPNEY ("KING OF THE ROAD")
    const jeepneyTexture = createJeepneyLiveryTexture();
    const balikbayanTexture = createBalikbayanBoxTexture();

    const jeepneyGroup = new THREE.Group();
    // Sitting flush on top of the concrete wharf (wharf top = 0.07), facing toward the ferry gangway
    // Scaled down to authentic miniature vehicle proportions (0.55x) relative to the massive Ro-Ro ship and pier
    jeepneyGroup.position.set(-0.35, 0.07, 0.35);
    jeepneyGroup.rotation.y = Math.PI * 0.5;
    jeepneyGroup.scale.set(0.55, 0.55, 0.55);
    pierGroup.add(jeepneyGroup);

    // Shared high-detail materials
    const chromeMat = new THREE.MeshStandardMaterial({
      color: "#f1f5f9",
      metalness: 0.95,
      roughness: 0.1,
    });
    const goldMat = new THREE.MeshStandardMaterial({
      color: "#fbbf24",
      metalness: 0.92,
      roughness: 0.18,
    });
    const darkSteelMat = new THREE.MeshStandardMaterial({
      color: "#1e293b",
      metalness: 0.8,
      roughness: 0.6,
    });
    const rubberTireMat = new THREE.MeshStandardMaterial({
      color: "#111827",
      roughness: 0.92,
    });
    const vinylSeatMat = new THREE.MeshStandardMaterial({
      color: "#831843", // Deep burgundy passenger vinyl seats
      roughness: 0.45,
    });
    const driverSeatMat = new THREE.MeshStandardMaterial({
      color: "#1e3a8a", // Blue driver seat
      roughness: 0.45,
    });
    const jeepLiveryMat = new THREE.MeshStandardMaterial({
      map: jeepneyTexture,
      metalness: 0.55,
      roughness: 0.28,
    });
    const windshieldGlassMat = new THREE.MeshPhysicalMaterial({
      color: "#e0f2fe",
      transmission: 0.85,
      roughness: 0.05,
      ior: 1.5,
      transparent: true,
      opacity: 0.9,
    });
    const headlightMat = new THREE.MeshStandardMaterial({
      color: "#fef08a",
      emissive: "#facc15",
      emissiveIntensity: 0.85,
      roughness: 0.15,
    });
    const amberLightMat = new THREE.MeshStandardMaterial({
      color: "#f59e0b",
      emissive: "#d97706",
      emissiveIntensity: 0.75,
      roughness: 0.2,
    });
    const tailLightRedMat = new THREE.MeshStandardMaterial({
      color: "#ef4444",
      emissive: "#b91c1c",
      emissiveIntensity: 0.8,
      roughness: 0.2,
    });
    const licenseMat = new THREE.MeshStandardMaterial({
      color: "#f8fafc",
      roughness: 0.5,
    });

    // --- A. UNDERCARRIAGE & CHASSIS ---
    // Twin dark steel frame rails
    [-0.14, 0.14].forEach((rx) => {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 1.25), darkSteelMat);
      rail.position.set(rx, 0.065, 0.02);
      jeepneyGroup.add(rail);
    });

    // Front & rear axles
    [0.38, -0.36].forEach((axZ) => {
      const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.46, 8), darkSteelMat);
      axle.rotation.z = Math.PI * 0.5;
      axle.position.set(0, 0.075, axZ);
      jeepneyGroup.add(axle);
    });

    // Exhaust pipe with chrome muffler tip on driver's side
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.75, 8), darkSteelMat);
    exhaust.rotation.x = Math.PI * 0.5;
    exhaust.position.set(-0.21, 0.05, -0.2);
    jeepneyGroup.add(exhaust);

    const exhaustTip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.12, 8), chromeMat);
    exhaustTip.rotation.x = Math.PI * 0.5;
    exhaustTip.position.set(-0.21, 0.05, -0.58);
    jeepneyGroup.add(exhaustTip);

    // --- B. WHEELS & CHROME HUBCAPS ---
    [
      [-0.235, 0.075, 0.38],
      [0.235, 0.075, 0.38],
      [-0.235, 0.075, -0.36],
      [0.235, 0.075, -0.36],
    ].forEach(([wx, wy, wz]) => {
      const wheelGroup = new THREE.Group();
      wheelGroup.position.set(wx, wy, wz);

      const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.058, 16), rubberTireMat);
      tire.rotation.z = Math.PI * 0.5;
      wheelGroup.add(tire);

      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.062, 14), chromeMat);
      rim.rotation.z = Math.PI * 0.5;
      wheelGroup.add(rim);

      const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.066, 6), goldMat);
      nut.rotation.z = Math.PI * 0.5;
      wheelGroup.add(nut);

      jeepneyGroup.add(wheelGroup);
    });

    // Mudflaps with safety reflectors behind rear wheels
    [-0.22, 0.22].forEach((mx) => {
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.07, 0.008), darkSteelMat);
      flap.position.set(mx, 0.065, -0.45);
      jeepneyGroup.add(flap);

      const reflector = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.014, 0.01), tailLightRedMat);
      reflector.position.set(mx, 0.045, -0.455);
      jeepneyGroup.add(reflector);
    });

    // --- C. LOWER BODY TUB & FLOOR ---
    const floor = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.02, 1.16), darkSteelMat);
    floor.position.set(0, 0.11, -0.02);
    jeepneyGroup.add(floor);

    // Left and Right lower side body panels with hand-painted airbrush livery
    [-0.22, 0.22].forEach((sx) => {
      const sidePanel = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.14, 1.14), jeepLiveryMat);
      sidePanel.position.set(sx, 0.18, -0.02);
      jeepneyGroup.add(sidePanel);

      const rubRail = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.15, 8), chromeMat);
      rubRail.rotation.x = Math.PI * 0.5;
      rubRail.position.set(sx * 1.05, 0.13, -0.02);
      jeepneyGroup.add(rubRail);

      const waistRail = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 1.15, 8), chromeMat);
      waistRail.rotation.x = Math.PI * 0.5;
      waistRail.position.set(sx * 1.05, 0.25, -0.02);
      jeepneyGroup.add(waistRail);
    });

    // --- D. FRONT HOOD, FENDERS & GRILLE (SARAO SIGNATURE) ---
    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.15, 0.42), chromeMat);
    hood.position.set(0, 0.2, 0.42);
    jeepneyGroup.add(hood);

    const hoodRidge = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.015, 0.42), goldMat);
    hoodRidge.position.set(0, 0.28, 0.42);
    jeepneyGroup.add(hoodRidge);

    // Flared front wheel arches (fenders)
    [-0.23, 0.23].forEach((fx) => {
      const fender = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.05, 12, 1, false, 0, Math.PI), chromeMat);
      fender.rotation.y = fx > 0 ? -Math.PI * 0.5 : Math.PI * 0.5;
      fender.position.set(fx, 0.12, 0.38);
      jeepneyGroup.add(fender);
    });

    // Front classic 7-slot vertical grille
    const grilleFrame = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.14, 0.02), chromeMat);
    grilleFrame.position.set(0, 0.19, 0.63);
    jeepneyGroup.add(grilleFrame);

    for (let slot = -3; slot <= 3; slot++) {
      const slotMesh = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.09, 0.025), darkSteelMat);
      slotMesh.position.set(slot * 0.045, 0.19, 0.63);
      jeepneyGroup.add(slotMesh);
    }

    // Heavy-duty front bullbar (Parachoke) & Bumper
    const frontBumper = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.04, 0.03), chromeMat);
    frontBumper.position.set(0, 0.1, 0.67);
    jeepneyGroup.add(frontBumper);

    const bullbarLoop = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.009, 6, 12, Math.PI), chromeMat);
    bullbarLoop.position.set(0, 0.15, 0.68);
    jeepneyGroup.add(bullbarLoop);

    [-0.14, 0.14].forEach((px) => {
      const pushBar = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.12, 8), chromeMat);
      pushBar.position.set(px, 0.15, 0.68);
      jeepneyGroup.add(pushBar);
    });

    const frontPlate = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.035, 0.008), licenseMat);
    frontPlate.position.set(0, 0.08, 0.69);
    jeepneyGroup.add(frontPlate);

    // Twin Circular Headlights with Chrome Outer Rings
    [-0.15, 0.15].forEach((hx) => {
      const hlHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.025, 12), chromeMat);
      hlHousing.rotation.x = Math.PI * 0.5;
      hlHousing.position.set(hx, 0.2, 0.64);
      jeepneyGroup.add(hlHousing);

      const hlLens = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.028, 12), headlightMat);
      hlLens.rotation.x = Math.PI * 0.5;
      hlLens.position.set(hx, 0.2, 0.642);
      jeepneyGroup.add(hlLens);

      const hlBezel = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.005, 6, 14), chromeMat);
      hlBezel.position.set(hx, 0.2, 0.655);
      jeepneyGroup.add(hlBezel);

      const amberPod = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 8), amberLightMat);
      amberPod.position.set(hx * 1.25, 0.14, 0.64);
      jeepneyGroup.add(amberPod);
    });

    // 4 Rearing Golden Sarao Colt Horses on the Hood
    [-0.13, -0.045, 0.045, 0.13].forEach((hx) => {
      const horse = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.055, 5), goldMat);
      horse.position.set(hx, 0.3, 0.56);
      horse.rotation.x = 0.25;
      jeepneyGroup.add(horse);

      const horseHead = new THREE.Mesh(new THREE.SphereGeometry(0.01, 6, 6), goldMat);
      horseHead.position.set(hx, 0.33, 0.575);
      jeepneyGroup.add(horseHead);
    });

    const eagleFin = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.035, 0.07), chromeMat);
    eagleFin.position.set(0, 0.3, 0.46);
    jeepneyGroup.add(eagleFin);

    // Twin Slender Chrome Fender Antennas
    [-0.2, 0.2].forEach((ax) => {
      const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.32, 6), chromeMat);
      antenna.position.set(ax, 0.35, 0.38);
      antenna.rotation.z = ax > 0 ? -0.15 : 0.15;
      jeepneyGroup.add(antenna);

      const antennaTip = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 6), tailLightRedMat);
      antennaTip.position.set(ax * 1.12, 0.51, 0.38);
      jeepneyGroup.add(antennaTip);
    });

    // Chrome Side Mirrors on A-Pillars
    [-0.26, 0.26].forEach((mx) => {
      const mirrorArm = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.07, 6), chromeMat);
      mirrorArm.rotation.z = mx > 0 ? -Math.PI * 0.4 : Math.PI * 0.4;
      mirrorArm.position.set(mx * 0.9, 0.33, 0.18);
      jeepneyGroup.add(mirrorArm);

      const mirrorHead = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.05, 0.03), chromeMat);
      mirrorHead.position.set(mx, 0.34, 0.18);
      jeepneyGroup.add(mirrorHead);
    });

    // --- E. DRIVER'S COCKPIT & SPLIT WINDSHIELD ---
    const windshieldFrame = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.13, 0.02), chromeMat);
    windshieldFrame.position.set(0, 0.33, 0.19);
    windshieldFrame.rotation.x = -0.18;
    jeepneyGroup.add(windshieldFrame);

    [-0.1, 0.1].forEach((wx) => {
      const wGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.1), windshieldGlassMat);
      wGlass.position.set(wx, 0.33, 0.195);
      wGlass.rotation.x = -0.18;
      jeepneyGroup.add(wGlass);
    });

    const routeSignboard = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.035, 0.005), goldMat);
    routeSignboard.position.set(0.1, 0.3, 0.185);
    routeSignboard.rotation.x = -0.18;
    jeepneyGroup.add(routeSignboard);

    const sunVisor = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.035, 0.08), chromeMat);
    sunVisor.position.set(0, 0.41, 0.23);
    sunVisor.rotation.x = 0.35;
    jeepneyGroup.add(sunVisor);

    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.08), darkSteelMat);
    dash.position.set(0, 0.24, 0.14);
    jeepneyGroup.add(dash);

    const steeringColumn = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.09, 6), darkSteelMat);
    steeringColumn.position.set(-0.1, 0.27, 0.1);
    steeringColumn.rotation.x = -0.55;
    jeepneyGroup.add(steeringColumn);

    const steeringWheel = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.006, 6, 14), darkSteelMat);
    steeringWheel.position.set(-0.1, 0.3, 0.065);
    steeringWheel.rotation.x = 1.0;
    jeepneyGroup.add(steeringWheel);

    const driverSeat = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.14), driverSeatMat);
    driverSeat.position.set(-0.1, 0.16, 0.02);
    jeepneyGroup.add(driverSeat);

    // --- F. PASSENGER BAY & PARALLEL BENCHES (OPEN SIDES) ---
    [-0.14, 0.14].forEach((bx) => {
      const benchCushion = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.62), vinylSeatMat);
      benchCushion.position.set(bx, 0.15, -0.27);
      jeepneyGroup.add(benchCushion);

      const benchBackrest = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.62), vinylSeatMat);
      benchBackrest.position.set(bx > 0 ? 0.2 : -0.2, 0.21, -0.27);
      jeepneyGroup.add(benchBackrest);
    });

    // 8 Chrome Vertical Roof Support Pillars (Open-air sides)
    [-0.21, 0.21].forEach((px) => {
      [-0.52, -0.28, -0.04, 0.18].forEach((pz) => {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.19, 8), chromeMat);
        pillar.position.set(px, 0.34, pz);
        jeepneyGroup.add(pillar);
      });

      const sideGrabRail = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.72, 8), chromeMat);
      sideGrabRail.rotation.x = Math.PI * 0.5;
      sideGrabRail.position.set(px, 0.28, -0.2);
      jeepneyGroup.add(sideGrabRail);
    });

    const ceilingGrabRail = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.85, 8), chromeMat);
    ceilingGrabRail.rotation.x = Math.PI * 0.5;
    ceilingGrabRail.position.set(0, 0.41, -0.15);
    jeepneyGroup.add(ceilingGrabRail);

    // --- G. STAINLESS STEEL ROOF & LUGGAGE RACK ---
    const roofCanopy = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.03, 1.15), chromeMat);
    roofCanopy.position.set(0, 0.44, -0.02);
    jeepneyGroup.add(roofCanopy);

    const roofTrim = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.012, 1.16), goldMat);
    roofTrim.position.set(0, 0.43, -0.02);
    jeepneyGroup.add(roofTrim);

    const rackFrame = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.01, 0.82), chromeMat);
    rackFrame.position.set(0, 0.46, -0.12);
    jeepneyGroup.add(rackFrame);

    [-0.2, 0.2].forEach((rx) => {
      const sideRail = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.82, 8), chromeMat);
      sideRail.rotation.x = Math.PI * 0.5;
      sideRail.position.set(rx, 0.5, -0.12);
      jeepneyGroup.add(sideRail);
    });

    [-0.52, 0.28].forEach((rz) => {
      const endRail = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.4, 8), chromeMat);
      endRail.rotation.z = Math.PI * 0.5;
      endRail.position.set(0, 0.5, rz);
      jeepneyGroup.add(endRail);
    });

    [-0.2, 0.2].forEach((sx) => {
      [-0.5, -0.12, 0.26].forEach((sz) => {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.06, 6), chromeMat);
        post.position.set(sx, 0.475, sz);
        jeepneyGroup.add(post);
      });
    });

    // --- H. AUTHENTIC CARGO ON ROOF RACK ---
    // 1. Two Balikbayan Heavy-Duty Cardboard Boxes with Tape & Labels
    const balikbayanMat = new THREE.MeshStandardMaterial({
      map: balikbayanTexture,
      roughness: 0.78,
    });

    const bBox1 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.28), balikbayanMat);
    bBox1.position.set(-0.08, 0.53, -0.14);
    bBox1.rotation.y = 0.08;
    jeepneyGroup.add(bBox1);

    const bBox2 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.22), balikbayanMat);
    bBox2.position.set(0.08, 0.52, -0.34);
    bBox2.rotation.y = -0.12;
    jeepneyGroup.add(bBox2);

    // 2. Woven Polypropylene Rice Sacks (Bigas)
    const riceSackMat = new THREE.MeshStandardMaterial({
      color: "#f1f5f9",
      roughness: 0.88,
    });
    const sackStripeMat = new THREE.MeshStandardMaterial({
      color: "#2563eb",
      roughness: 0.8,
    });

    const sack1 = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), riceSackMat);
    sack1.scale.set(1.4, 0.65, 1.05);
    sack1.position.set(-0.06, 0.51, 0.1);
    sack1.rotation.y = 0.3;
    jeepneyGroup.add(sack1);

    const sackStripe = new THREE.Mesh(new THREE.CylinderGeometry(0.092, 0.092, 0.025, 8), sackStripeMat);
    sackStripe.scale.set(1.4, 0.65, 1.05);
    sackStripe.position.set(-0.06, 0.51, 0.1);
    sackStripe.rotation.y = 0.3;
    jeepneyGroup.add(sackStripe);

    // 3. Wooden Fruit Crate with Carabao Mangoes
    const fruitCrateMat = new THREE.MeshStandardMaterial({
      color: "#92400e",
      roughness: 0.85,
    });
    const jeepMangoMat = new THREE.MeshStandardMaterial({
      color: "#facc15",
      roughness: 0.35,
    });

    const fruitCrate = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.09, 0.22), fruitCrateMat);
    fruitCrate.position.set(0.09, 0.51, 0.12);
    jeepneyGroup.add(fruitCrate);

    for (let m = 0; m < 5; m++) {
      const mango = new THREE.Mesh(new THREE.SphereGeometry(0.026, 7, 7), jeepMangoMat);
      mango.scale.set(1.3, 0.85, 0.85);
      mango.position.set(0.06 + (m % 2) * 0.055, 0.56, 0.07 + Math.floor(m / 2) * 0.05);
      jeepneyGroup.add(mango);
    }

    // 4. Spare Tire Mounted on Roof Rack
    const spareTire = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.048, 14), rubberTireMat);
    spareTire.position.set(0, 0.49, -0.42);
    jeepneyGroup.add(spareTire);

    const spareRim = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.052, 12), chromeMat);
    spareRim.position.set(0, 0.49, -0.42);
    jeepneyGroup.add(spareRim);

    // Yellow tie-down straps over cargo
    const strapMat = new THREE.MeshBasicMaterial({ color: "#eab308" });
    const strap1 = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.008, 0.016), strapMat);
    strap1.position.set(0, 0.6, -0.15);
    jeepneyGroup.add(strap1);

    // --- I. REAR ENTRANCE, STEPBOARD & TAIL LIGHTS ---
    [-0.17, 0.17].forEach((rx) => {
      const rearCorner = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.24, 0.02), jeepLiveryMat);
      rearCorner.position.set(rx, 0.23, -0.59);
      jeepneyGroup.add(rearCorner);

      // Stacked triple round tail lights on each rear pillar (Red, Amber, White)
      const redTail = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.01, 8), tailLightRedMat);
      redTail.rotation.x = Math.PI * 0.5;
      redTail.position.set(rx, 0.3, -0.605);
      jeepneyGroup.add(redTail);

      const amberTail = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.01, 8), amberLightMat);
      amberTail.rotation.x = Math.PI * 0.5;
      amberTail.position.set(rx, 0.26, -0.605);
      jeepneyGroup.add(amberTail);

      const whiteTail = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 8), headlightMat);
      whiteTail.rotation.x = Math.PI * 0.5;
      whiteTail.position.set(rx, 0.22, -0.605);
      jeepneyGroup.add(whiteTail);
    });

    // Extended rear boarding stepboard / conductor platform (Parachoke sa likod)
    const rearStepboard = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.025, 0.12), chromeMat);
    rearStepboard.position.set(0, 0.09, -0.65);
    jeepneyGroup.add(rearStepboard);

    // Twin vertical yellow grab bars on each side of the rear entrance
    [-0.11, 0.11].forEach((gx) => {
      const grabPole = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.28, 8), goldMat);
      grabPole.position.set(gx, 0.26, -0.6);
      jeepneyGroup.add(grabPole);
    });

    // Rear license plate
    const rearPlate = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.008), licenseMat);
    rearPlate.position.set(-0.16, 0.14, -0.605);
    jeepneyGroup.add(rearPlate);

    // 9. FLAGSHIP PHILIPPINE RO-RO INTER-ISLAND PASSENGER SHIP (M/V PANTALAN EXPRESS)
    // Sized to authentic monumental inter-island scale (3.6m length, 1.25m beam, 1.45m height)
    const roroGroup = new THREE.Group();
    roroGroup.position.set(-0.95, 3.42, -0.3);
    scene.add(roroGroup);

    // Naval architecture materials
    const hullAntiFoulingMat = new THREE.MeshStandardMaterial({
      color: "#991b1b", // Antifouling red bottom
      roughness: 0.52,
    });
    const hullBootTopMat = new THREE.MeshStandardMaterial({
      map: ferryTexture,
      roughness: 0.35,
      metalness: 0.15,
    });
    const superstructureMat = new THREE.MeshStandardMaterial({
      color: "#f8fafc",
      roughness: 0.3,
    });
    const deckPlankMat = new THREE.MeshStandardMaterial({
      color: "#78716c", // Non-skid marine gray deck
      roughness: 0.75,
    });
    const darkAnchorMat = new THREE.MeshStandardMaterial({
      color: "#0f172a",
      metalness: 0.85,
      roughness: 0.35,
    });
    const shipRailingMat = new THREE.MeshStandardMaterial({
      color: "#e2e8f0",
      metalness: 0.85,
      roughness: 0.2,
    });
    const lifebuoyOrangeMat = new THREE.MeshStandardMaterial({
      color: "#ea580c",
      roughness: 0.35,
    });
    const funnelBandMat = new THREE.MeshStandardMaterial({
      color: "#1e3a8a",
      roughness: 0.35,
    });
    const funnelGoldMat = new THREE.MeshStandardMaterial({
      color: "#eab308",
      roughness: 0.35,
    });
    const bridgeGlassMat = new THREE.MeshPhysicalMaterial({
      color: "#0284c7",
      transmission: 0.78,
      roughness: 0.1,
      ior: 1.48,
      transparent: true,
      opacity: 0.95,
    });
    const navLightGreenMat = new THREE.MeshStandardMaterial({
      color: "#10b981",
      emissive: "#059669",
      emissiveIntensity: 0.9,
    });
    const navLightRedMat = new THREE.MeshStandardMaterial({
      color: "#ef4444",
      emissive: "#dc2626",
      emissiveIntensity: 0.9,
    });
    const navLightWhiteMat = new THREE.MeshStandardMaterial({
      color: "#f8fafc",
      emissive: "#ffffff",
      emissiveIntensity: 0.9,
    });

    // --- A. LOWER HULL (RED UNDERBODY & BULBOUS RAKED BOW) ---
    const redHull = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.26, 3.4), hullAntiFoulingMat);
    redHull.position.y = -0.06;
    roroGroup.add(redHull);

    const bowCone = new THREE.Mesh(new THREE.ConeGeometry(0.61, 0.65, 4), hullAntiFoulingMat);
    bowCone.rotation.x = -Math.PI * 0.5;
    bowCone.position.set(0, -0.06, 1.95);
    roroGroup.add(bowCone);

    const bootTopHull = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.22, 3.48), hullBootTopMat);
    bootTopHull.position.y = 0.12;
    roroGroup.add(bootTopHull);

    const bowWedge = new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.65, 4), superstructureMat);
    bowWedge.rotation.x = -Math.PI * 0.5;
    bowWedge.position.set(0, 0.14, 1.96);
    roroGroup.add(bowWedge);

    // Bow Anchors & Hawseholes in anchor pockets
    [-0.56, 0.56].forEach((ax) => {
      const hawseHole = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.015, 6, 12), darkAnchorMat);
      hawseHole.position.set(ax, 0.15, 1.75);
      hawseHole.rotation.y = ax > 0 ? 0.4 : -0.4;
      roroGroup.add(hawseHole);

      const anchorFluke = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 6, 10, Math.PI), darkAnchorMat);
      anchorFluke.rotation.z = Math.PI;
      anchorFluke.position.set(ax * 1.05, 0.04, 1.75);
      roroGroup.add(anchorFluke);

      const anchorShank = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 6), darkAnchorMat);
      anchorShank.position.set(ax * 1.05, 0.09, 1.75);
      roroGroup.add(anchorShank);
    });

    // White heavy rubber rub-rails along port and starboard hull sides
    [-0.63, 0.63].forEach((rx) => {
      const rubRail = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 3.4, 8), superstructureMat);
      rubRail.rotation.x = Math.PI * 0.5;
      rubRail.position.set(rx, 0.22, 0);
      roroGroup.add(rubRail);
    });

    // --- B. VEHICLE CAR DECK & STERN RAMP ---
    const carDeckCeiling = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 3.2), deckPlankMat);
    carDeckCeiling.position.set(0, 0.32, -0.1);
    roroGroup.add(carDeckCeiling);

    // Heavy Ribbed Steel Vehicle Ramp (lowered directly onto the wharf apron!)
    const rampMat = new THREE.MeshStandardMaterial({
      color: "#475569",
      metalness: 0.8,
      roughness: 0.45,
    });
    const sternRamp = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.04, 0.82), rampMat);
    sternRamp.position.set(-0.25, 0.08, -2.05);
    sternRamp.rotation.x = 0.28;
    sternRamp.rotation.y = -0.22;
    roroGroup.add(sternRamp);

    [-0.38, 0.38].forEach((px) => {
      const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.52, 6), shipRailingMat);
      piston.position.set(px, 0.38, -1.72);
      piston.rotation.x = -0.4;
      roroGroup.add(piston);
    });

    // --- C. MAIN PASSENGER SALOON DECK ---
    const passengerCabin = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.44, 2.7), hullBootTopMat);
    passengerCabin.position.set(0, 0.54, -0.05);
    roroGroup.add(passengerCabin);

    // Life Raft Canister Racks (6 white cylindrical escape capsules)
    [-0.61, 0.61].forEach((lx) => {
      [-0.6, -0.1, 0.4].forEach((lz) => {
        const canister = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.16, 8), superstructureMat);
        canister.rotation.x = Math.PI * 0.5;
        canister.position.set(lx, 0.56, lz);
        roroGroup.add(canister);

        const rackStrap = new THREE.Mesh(new THREE.TorusGeometry(0.048, 0.006, 4, 8), shipRailingMat);
        rackStrap.rotation.x = Math.PI * 0.5;
        rackStrap.position.set(lx, 0.56, lz);
        roroGroup.add(rackStrap);
      });
    });

    // --- D. UPPER PROMENADE OBSERVATION DECK & RAILS ---
    const promenadeDeck = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.04, 2.65), deckPlankMat);
    promenadeDeck.position.set(0, 0.77, -0.05);
    roroGroup.add(promenadeDeck);

    [-0.56, 0.56].forEach((rx) => {
      for (let pz = -1.3; pz <= 1.25; pz += 0.42) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.18, 6), shipRailingMat);
        post.position.set(rx, 0.88, pz);
        roroGroup.add(post);
      }
      const topRail = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 2.58, 8), shipRailingMat);
      topRail.rotation.x = Math.PI * 0.5;
      topRail.position.set(rx, 0.97, -0.03);
      roroGroup.add(topRail);

      const midRail = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 2.58, 8), shipRailingMat);
      midRail.rotation.x = Math.PI * 0.5;
      midRail.position.set(rx, 0.88, -0.03);
      roroGroup.add(midRail);
    });

    const benchWoodMat = new THREE.MeshStandardMaterial({ color: "#b45309", roughness: 0.65 });
    [-0.32, 0.32].forEach((bx) => {
      const bench = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.42), benchWoodMat);
      bench.position.set(bx, 0.82, -0.6);
      roroGroup.add(bench);
    });

    [-0.57, 0.57].forEach((bx) => {
      [-0.4, 0.4].forEach((bz) => {
        const buoy = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.016, 6, 14), lifebuoyOrangeMat);
        buoy.position.set(bx, 0.89, bz);
        buoy.rotation.y = Math.PI * 0.5;
        roroGroup.add(buoy);
      });
    });

    // --- E. COMMAND NAVIGATION BRIDGE & BRIDGE WINGS ---
    const bridgeHouse = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.32, 0.78), superstructureMat);
    bridgeHouse.position.set(0, 0.93, 0.72);
    roroGroup.add(bridgeHouse);

    const bridgeGlass = new THREE.Mesh(new THREE.BoxGeometry(0.99, 0.14, 0.52), bridgeGlassMat);
    bridgeGlass.position.set(0, 0.98, 0.86);
    roroGroup.add(bridgeGlass);

    [-0.66, 0.66].forEach((wx) => {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.03, 0.28), deckPlankMat);
      wing.position.set(wx, 0.88, 0.86);
      roroGroup.add(wing);

      const wPost = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.18, 6), shipRailingMat);
      wPost.position.set(wx > 0 ? wx + 0.16 : wx - 0.16, 0.98, 0.86);
      roroGroup.add(wPost);

      const searchLight = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.04, 8), shipRailingMat);
      searchLight.rotation.x = Math.PI * 0.4;
      searchLight.position.set(wx > 0 ? wx + 0.12 : wx - 0.12, 1.02, 0.86);
      roroGroup.add(searchLight);
    });

    // --- F. RADAR MAST, SENSORS & NAVIGATION LIGHTS ---
    const mainMast = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.026, 0.65, 8), superstructureMat);
    mainMast.position.set(0, 1.38, 0.65);
    roroGroup.add(mainMast);

    const mastCrossbar = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.44, 8), superstructureMat);
    mastCrossbar.rotation.z = Math.PI * 0.5;
    mastCrossbar.position.set(0, 1.55, 0.65);
    roroGroup.add(mastCrossbar);

    const ferryRadarScanner = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.022, 0.032), shipRailingMat);
    ferryRadarScanner.position.set(0, 1.72, 0.65);
    roroGroup.add(ferryRadarScanner);

    const greenLight = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), navLightGreenMat);
    greenLight.position.set(0.22, 1.55, 0.65);
    roroGroup.add(greenLight);

    const redLight = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), navLightRedMat);
    redLight.position.set(-0.22, 1.55, 0.65);
    roroGroup.add(redLight);

    const whiteMastLight = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), navLightWhiteMat);
    whiteMastLight.position.set(0, 1.74, 0.65);
    roroGroup.add(whiteMastLight);

    [-0.1, 0.1].forEach((ax) => {
      const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.45, 6), shipRailingMat);
      whip.position.set(ax, 1.25, 0.4);
      whip.rotation.x = -0.15;
      roroGroup.add(whip);
    });

    // --- G. DUAL AERODYNAMIC ANGLED FUNNELS ---
    [-0.24, 0.24].forEach((fx) => {
      const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.48, 12), superstructureMat);
      funnel.position.set(fx, 1.02, -0.35);
      funnel.rotation.x = -0.18;
      roroGroup.add(funnel);

      const fBand = new THREE.Mesh(new THREE.CylinderGeometry(0.094, 0.098, 0.14, 12), funnelBandMat);
      fBand.position.set(fx, 1.06, -0.35);
      fBand.rotation.x = -0.18;
      roroGroup.add(fBand);

      const fGold = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.096, 0.035, 12), funnelGoldMat);
      fGold.position.set(fx, 1.13, -0.37);
      fGold.rotation.x = -0.18;
      roroGroup.add(fGold);

      const fRim = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.014, 6, 12), darkAnchorMat);
      fRim.position.set(fx, 1.25, -0.4);
      fRim.rotation.x = Math.PI * 0.5 - 0.18;
      roroGroup.add(fRim);
    });

    // --- H. PHYSICAL BRAIDED MOORING LINES ---
    const bowLine = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.85, 6), ropeMat);
    bowLine.position.set(-0.7, 0.15, 0.8);
    bowLine.rotation.z = 0.35;
    bowLine.rotation.y = 0.5;
    roroGroup.add(bowLine);

    const sternLine = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.85, 6), ropeMat);
    sternLine.position.set(-0.7, 0.15, -1.3);
    sternLine.rotation.z = 0.35;
    sternLine.rotation.y = -0.5;
    roroGroup.add(sternLine);

    // 10. TWO TRADITIONAL PHILIPPINE MOTORIZED BANGKAS (AUTHENTIC PUMPBOATS)
    function buildBangka(hullColor: string, canopyColor: string): { group: THREE.Group; prop: THREE.Mesh } {
      const bGroup = new THREE.Group();

      const bHullMat = new THREE.MeshStandardMaterial({ color: hullColor, roughness: 0.38 });
      const bTrimMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.4 });
      const bBambooMat = new THREE.MeshStandardMaterial({ color: "#ca8a04", roughness: 0.6 });
      const bRattanMat = new THREE.MeshStandardMaterial({ color: "#78350f", roughness: 0.8 });
      const bCanopyMat = new THREE.MeshStandardMaterial({ color: canopyColor, roughness: 0.5, side: THREE.DoubleSide });
      const bEngineMat = new THREE.MeshStandardMaterial({ color: "#1e293b", metalness: 0.8, roughness: 0.4 });
      const bBrassMat = new THREE.MeshStandardMaterial({ color: "#eab308", metalness: 0.92, roughness: 0.18 });

      // Swept Carved Wooden Canoe Hull (Baroto)
      const mainHull = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.15, 1.28), bHullMat);
      bGroup.add(mainHull);

      // Swept sharp bow prow (Dulong)
      const bowProw = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.42, 4), bHullMat);
      bowProw.rotation.x = -Math.PI * 0.5;
      bowProw.position.set(0, 0.03, 0.84);
      bGroup.add(bowProw);

      // Swept stern
      const sternProw = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.28, 4), bHullMat);
      sternProw.rotation.x = Math.PI * 0.5;
      sternProw.position.set(0, 0.02, -0.76);
      bGroup.add(sternProw);

      [-0.085, 0.085].forEach((gx) => {
        const gunwale = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 1.28, 8), bTrimMat);
        gunwale.rotation.x = Math.PI * 0.5;
        gunwale.position.set(gx, 0.075, 0);
        bGroup.add(gunwale);
      });

      // Bamboo Outriggers (Katig & Tarik)
      [-0.46, 0.46].forEach((kx) => {
        const floatPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.034, 1.35, 8), bBambooMat);
        floatPipe.rotation.x = Math.PI * 0.5;
        floatPipe.position.set(kx, -0.02, -0.05);
        bGroup.add(floatPipe);

        const floatTip = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.24, 8), bBambooMat);
        floatTip.rotation.x = -Math.PI * 0.5;
        floatTip.position.set(kx, 0.02, 0.72);
        bGroup.add(floatTip);

        [-0.42, 0.02, 0.46].forEach((cz) => {
          const spar = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.48, 6), bBambooMat);
          spar.rotation.z = Math.PI * 0.5;
          spar.position.set(kx * 0.5, 0.075, cz);
          bGroup.add(spar);

          const lashing = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.008, 4, 8), bRattanMat);
          lashing.position.set(kx, 0.01, cz);
          bGroup.add(lashing);
        });
      });

      // Inboard Pumpboat Diesel Motor, Drive Shaft & Propeller
      const engineBlock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.12), bEngineMat);
      engineBlock.position.set(0, 0.07, -0.22);
      bGroup.add(engineBlock);

      const flywheel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.025, 10), bEngineMat);
      flywheel.rotation.z = Math.PI * 0.5;
      flywheel.position.set(0.05, 0.07, -0.22);
      bGroup.add(flywheel);

      const driveShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.65, 6), bBrassMat);
      driveShaft.rotation.x = -0.32;
      driveShaft.position.set(0, -0.04, -0.56);
      bGroup.add(driveShaft);

      const prop = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.014, 0.014), bBrassMat);
      prop.position.set(0, -0.13, -0.84);
      bGroup.add(prop);

      const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.12, 0.09), bBambooMat);
      rudder.position.set(0, -0.04, -0.72);
      bGroup.add(rudder);

      // Arched Sun Canopy with Scalloped Fringe
      const canopy = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.72, 12, 1, true, 0, Math.PI), bCanopyMat);
      canopy.rotation.z = Math.PI * 0.5;
      canopy.rotation.y = Math.PI * 0.5;
      canopy.position.set(0, 0.23, 0.08);
      bGroup.add(canopy);

      [-0.075, 0.075].forEach((cx) => {
        [-0.22, 0.38].forEach((cz) => {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.19, 6), bBambooMat);
          post.position.set(cx, 0.16, cz);
          bGroup.add(post);
        });
      });

      return { group: bGroup, prop };
    }

    const mooredBangkaData = buildBangka("#ffffff", "#0284c7");
    const mooredBangka = mooredBangkaData.group;
    mooredBangka.position.set(-1.25, 3.42, 1.7);
    mooredBangka.rotation.y = 0.25;
    scene.add(mooredBangka);

    const cruisingBangkaData = buildBangka("#06b6d4", "#f43f5e");
    const cruisingBangka = cruisingBangkaData.group;
    scene.add(cruisingBangka);

    const wakeGroup = new THREE.Group();
    const wakeMat = new THREE.MeshBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const wakeMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.75), wakeMat);
    wakeMesh.rotation.x = -Math.PI * 0.5;
    wakeMesh.position.set(0, 0.01, -0.48);
    wakeGroup.add(wakeMesh);
    scene.add(wakeGroup);

    const cruisingData: CruisingBangka = {
      group: cruisingBangka,
      wakeGroup,
      t: 0,
      speed: 0.35,
      propeller: cruisingBangkaData.prop,
    };

    // 11. EL NIDO / CORON LIMESTONE KARST ISLET & NATURAL SEA ARCH
    // Placed on East side at (3.0, 0, -1.6) with radius <= 0.65 (strictly inside bounds 4.8 x 3.2, zero glass clipping)
    const coralStoneTexture = createCoralStoneTexture();
    const karstGroup = new THREE.Group();
    karstGroup.position.set(3.0, 0, -1.6);
    scene.add(karstGroup);

    const rockMat = new THREE.MeshStandardMaterial({
      color: "#374151",
      roughness: 0.95,
      metalness: 0.1,
    });
    const mossMat = new THREE.MeshStandardMaterial({
      color: "#166534",
      roughness: 0.85,
    });

    // Primary Karst Spire
    const r1 = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.62, 2.8, 8), rockMat);
    r1.position.y = 1.4;
    karstGroup.add(r1);

    const r2 = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.48, 2.2, 7), rockMat);
    r2.position.set(0.04, 3.1, -0.04);
    karstGroup.add(r2);

    const mossCap = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.35, 7), mossMat);
    mossCap.position.set(0.04, 4.25, -0.04);
    karstGroup.add(mossCap);

    // Secondary Karst Spire forming natural Sea Arch opening
    const rArch = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.34, 2.2, 6), rockMat);
    rArch.position.set(-0.62, 1.1, 0.16);
    karstGroup.add(rArch);

    const archSpan = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.28, 0.36), rockMat);
    archSpan.position.set(-0.32, 2.05, 0.08);
    archSpan.rotation.z = -0.18;
    karstGroup.add(archSpan);

    const archMoss = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 0.34), mossMat);
    archMoss.position.set(-0.32, 2.22, 0.08);
    archMoss.rotation.z = -0.18;
    karstGroup.add(archMoss);

    // Spanish-Colonial Whitewashed Coral Stone Parola (Lighthouse) perched on summit
    const parolaMat = new THREE.MeshStandardMaterial({
      map: coralStoneTexture,
      roughness: 0.68,
    });
    const domeMat = new THREE.MeshStandardMaterial({ color: "#991b1b", roughness: 0.38 });
    const ironMat = new THREE.MeshStandardMaterial({ color: "#0f172a", roughness: 0.42 });

    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 1.25, 8), parolaMat);
    tower.position.set(0.04, 4.95, -0.04);
    karstGroup.add(tower);

    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.08, 12), ironMat);
    gallery.position.set(0.04, 5.62, -0.04);
    karstGroup.add(gallery);

    const lanternGlassMat = new THREE.MeshPhysicalMaterial({
      color: "#ffffff",
      transmission: 0.88,
      roughness: 0.08,
      ior: 1.52,
    });
    const lanternRoom = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.32, 8), lanternGlassMat);
    lanternRoom.position.set(0.04, 5.82, -0.04);
    karstGroup.add(lanternRoom);

    const domeRoof = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), domeMat);
    domeRoof.position.set(0.04, 5.98, -0.04);
    karstGroup.add(domeRoof);

    // Rotating Volumetric Light Beam
    const beamGeo = new THREE.ConeGeometry(0.65, 3.6, 16, 1, true);
    beamGeo.translate(0, 1.8, 0);
    beamGeo.rotateX(Math.PI * 0.5);

    const beamMat = new THREE.MeshBasicMaterial({
      color: "#fef08a",
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const lightBeam = new THREE.Mesh(beamGeo, beamMat);
    lightBeam.position.set(0.04, 5.84, -0.04);
    karstGroup.add(lightBeam);

    // 12. TRADITIONAL OFFSHORE STILT FISHERMAN'S HUT ("BAHAY KUBO SA LAOT")
    // Anchored at (2.4, 3.42, 1.4) with bamboo stilts reaching seabed
    const stiltHutGroup = new THREE.Group();
    stiltHutGroup.position.set(2.4, 3.42, 1.4);
    scene.add(stiltHutGroup);

    const hutBambooMat = new THREE.MeshStandardMaterial({ color: "#ca8a04", roughness: 0.65 });
    const hutThatchMat = new THREE.MeshStandardMaterial({ color: "#b45309", roughness: 0.95 });
    const sawaliMat = new THREE.MeshStandardMaterial({ color: "#d97706", roughness: 0.8 });
    const rattanMat = new THREE.MeshStandardMaterial({ color: "#78350f", roughness: 0.82 });
    const hutAlgaeMat = new THREE.MeshStandardMaterial({ color: "#14532d", roughness: 0.9 });

    // 4 Tall bamboo stilts extending from hut deck down through water to seabed (y = -1.8)
    for (let hx = -0.32; hx <= 0.32; hx += 0.64) {
      for (let hz = -0.26; hz <= 0.26; hz += 0.52) {
        const pStilt = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.036, 3.6, 8), hutBambooMat);
        pStilt.position.set(hx, -1.8, hz);
        stiltHutGroup.add(pStilt);

        // Waterline algae collar
        const pAlgae = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.65, 8), hutAlgaeMat);
        pAlgae.position.set(hx, -0.3, hz);
        stiltHutGroup.add(pAlgae);
      }
    }

    // Raised slatted bamboo floor deck
    const hutDeck = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.05, 0.76), hutBambooMat);
    hutDeck.position.set(0, 0.03, 0);
    stiltHutGroup.add(hutDeck);

    // Bamboo sawali living quarters
    const hutWalls = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.44, 0.56), sawaliMat);
    hutWalls.position.set(0, 0.27, 0);
    stiltHutGroup.add(hutWalls);

    // Steep pitched nipa palm thatch roof
    const hutRoof = new THREE.Mesh(new THREE.ConeGeometry(0.68, 0.56, 4), hutThatchMat);
    hutRoof.position.set(0, 0.74, 0);
    hutRoof.rotation.y = Math.PI * 0.25;
    stiltHutGroup.add(hutRoof);

    // Propped open window awning on front wall
    const windowAwning = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.02, 0.18), hutThatchMat);
    windowAwning.position.set(0, 0.42, 0.32);
    windowAwning.rotation.x = -0.45;
    stiltHutGroup.add(windowAwning);

    // Hanging woven rattan fish trap (bubo)
    const buboTrap = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.065, 0.18, 6), rattanMat);
    buboTrap.position.set(0.36, -0.15, 0.2);
    stiltHutGroup.add(buboTrap);

    // Slanted bamboo access ladder to water surface
    const hutLadder = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.58, 0.02), hutBambooMat);
    hutLadder.position.set(-0.36, -0.22, 0.28);
    hutLadder.rotation.x = 0.22;
    stiltHutGroup.add(hutLadder);

    // Tiny wooden dugout canoe (baroto) moored alongside
    const barotoHull = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.56), new THREE.MeshStandardMaterial({ color: "#78350f", roughness: 0.6 }));
    barotoHull.position.set(-0.48, 0.01, 0.36);
    barotoHull.rotation.y = 0.35;
    stiltHutGroup.add(barotoHull);

    // Hanging warm evening lantern under the eaves
    const hutLantern = new THREE.Mesh(new THREE.SphereGeometry(0.034, 8, 8), new THREE.MeshStandardMaterial({
      color: "#fbbf24",
      emissive: "#f59e0b",
      emissiveIntensity: 0.9,
    }));
    hutLantern.position.set(0.28, 0.46, 0.3);
    stiltHutGroup.add(hutLantern);

    // 13. WHITE SAND SANDBAR ISLET WITH LEANING COCONUT PALMS
    // Positioned at (3.5, 3.4, 0.55)
    const sandbarGroup = new THREE.Group();
    sandbarGroup.position.set(3.5, 3.4, 0.55);
    scene.add(sandbarGroup);

    // Pristine Palawan white sand mound emerging above the water
    const sandMound = new THREE.Mesh(
      new THREE.SphereGeometry(0.75, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.45),
      seabedMat
    );
    sandMound.scale.set(1.15, 0.22, 0.78);
    sandMound.position.y = -0.05;
    sandbarGroup.add(sandMound);

    // Palm 1: Tall graceful coconut palm leaning over turquoise lagoon
    const sandbarPalm1Data = createRealisticPalmTree(1.75, -0.42, 0.24, palmBarkMat, palmFrondMat, palmCoconutMat);
    const sandbarPalm1 = sandbarPalm1Data.group;
    sandbarPalm1.position.set(-0.16, 0.04, 0);
    sandbarGroup.add(sandbarPalm1);
    allPalmFronds.push(...sandbarPalm1Data.fronds);

    // Palm 2: Companion leaning palm angled towards the sea
    const sandbarPalm2Data = createRealisticPalmTree(1.38, 0.38, -0.26, palmBarkMat, palmFrondMat, palmCoconutMat);
    const sandbarPalm2 = sandbarPalm2Data.group;
    sandbarPalm2.position.set(0.24, 0.04, -0.1);
    sandbarGroup.add(sandbarPalm2);
    allPalmFronds.push(...sandbarPalm2Data.fronds);

    // Weathered driftwood log resting on the sand
    const driftwoodLog = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.038, 0.46, 6), palmBarkMat);
    driftwoodLog.rotation.x = Math.PI * 0.5;
    driftwoodLog.rotation.y = 0.42;
    driftwoodLog.position.set(0.02, 0.03, 0.16);
    sandbarGroup.add(driftwoodLog);

    // 14. TRADITIONAL PHILIPPINE SAILING PARAW (WITH COLORFUL LAYAG SAIL)
    // Sized to authentic Visayan regatta proportions (1.4m hull, twin outriggers, 1.4m mast)
    const parawSailTexture = createParawSailTexture();
    const parawGroup = new THREE.Group();
    parawGroup.position.set(3.6, 3.42, -0.45);
    parawGroup.rotation.y = -0.35;
    scene.add(parawGroup);

    const parawHullMat = new THREE.MeshStandardMaterial({ color: "#f8fafc", roughness: 0.35 });
    const parawBambooMat = new THREE.MeshStandardMaterial({ color: "#ca8a04", roughness: 0.6 });
    const parawRattanMat = new THREE.MeshStandardMaterial({ color: "#78350f", roughness: 0.8 });

    // Sleek carved Baroto canoe hull
    const parawHull = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.14, 1.35), parawHullMat);
    parawGroup.add(parawHull);

    const parawBow = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.38, 4), parawHullMat);
    parawBow.rotation.x = -Math.PI * 0.5;
    parawBow.position.set(0, 0.02, 0.85);
    parawGroup.add(parawBow);

    const parawStern = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.28, 4), parawHullMat);
    parawStern.rotation.x = Math.PI * 0.5;
    parawStern.position.set(0, 0.02, -0.78);
    parawGroup.add(parawStern);

    // Twin wide bamboo outriggers (Katig & Tarik)
    [-0.52, 0.52].forEach((kx) => {
      const floatPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 1.45, 8), parawBambooMat);
      floatPipe.rotation.x = Math.PI * 0.5;
      floatPipe.position.set(kx, -0.02, 0);
      parawGroup.add(floatPipe);

      const floatTip = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.26, 8), parawBambooMat);
      floatTip.rotation.x = -Math.PI * 0.5;
      floatTip.position.set(kx, 0.02, 0.82);
      parawGroup.add(floatTip);

      [-0.42, 0.04, 0.48].forEach((cz) => {
        const spar = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.54, 6), parawBambooMat);
        spar.rotation.z = Math.PI * 0.5;
        spar.position.set(kx * 0.5, 0.075, cz);
        parawGroup.add(spar);

        const lashing = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.007, 4, 8), parawRattanMat);
        lashing.position.set(kx, 0.01, cz);
        parawGroup.add(lashing);
      });
    });

    // Tall Bamboo Mast & Spar Boom
    const parawMast = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 1.38, 8), parawBambooMat);
    parawMast.position.set(0, 0.72, 0.15);
    parawGroup.add(parawMast);

    const parawBoom = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.98, 6), parawBambooMat);
    parawBoom.rotation.x = Math.PI * 0.5;
    parawBoom.position.set(0.08, 0.22, -0.32);
    parawBoom.rotation.y = 0.18;
    parawGroup.add(parawBoom);

    // Billowing Hand-Dyed Triangular Layag Sail
    const sailGeo = new THREE.BufferGeometry();
    const sv = new Float32Array([
      0, 1.38, 0.15,    // mast peak
      0.16, 0.22, -0.78, // boom end
      0.04, 0.26, 0.15,  // mast tack
    ]);
    const suvs = new Float32Array([
      0.5, 1.0,
      1.0, 0.0,
      0.0, 0.0,
    ]);
    sailGeo.setAttribute("position", new THREE.BufferAttribute(sv, 3));
    sailGeo.setAttribute("uv", new THREE.BufferAttribute(suvs, 2));
    sailGeo.computeVertexNormals();

    const sailMat = new THREE.MeshStandardMaterial({
      map: parawSailTexture,
      side: THREE.DoubleSide,
      roughness: 0.55,
    });
    const parawSail = new THREE.Mesh(sailGeo, sailMat);
    parawGroup.add(parawSail);

    // 15. FIVE COASTAL SEA TERNS (TAGAK) IN THE SKY
    const birds: BirdData[] = [];
    const birdMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.48 });
    const beakMat = new THREE.MeshStandardMaterial({ color: "#eab308", roughness: 0.4 });

    for (let b = 0; b < 5; b++) {
      const bGroup = new THREE.Group();

      const body = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.22, 6), birdMat);
      body.rotation.x = Math.PI * 0.5;
      bGroup.add(body);

      const beak = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.08, 4), beakMat);
      beak.rotation.x = -Math.PI * 0.5;
      beak.position.set(0, 0, 0.14);
      bGroup.add(beak);

      const wingGeo = new THREE.BufferGeometry();
      const wv = new Float32Array([
        0, 0, 0,
        0.24, 0, -0.06,
        0, 0, -0.14,
      ]);
      wingGeo.setAttribute("position", new THREE.BufferAttribute(wv, 3));
      wingGeo.computeVertexNormals();

      const wL = new THREE.Mesh(wingGeo, birdMat);
      wL.position.set(0.02, 0, 0.02);
      bGroup.add(wL);

      const wR = new THREE.Mesh(wingGeo, birdMat);
      wR.scale.set(-1, 1, 1);
      wR.position.set(-0.02, 0, 0.02);
      bGroup.add(wR);

      scene.add(bGroup);

      birds.push({
        group: bGroup,
        wingLeft: wL,
        wingRight: wR,
        orbitRadius: 3.6 + (b % 3) * 0.9,
        speed: 0.78 + (b % 2) * 0.35,
        angle: (b / 5) * Math.PI * 2,
        baseY: 4.8 + b * 0.35,
        flapSpeed: 9.8 + b * 1.8,
        bankFactor: 0.15 + (b % 2) * 0.08,
      });
    }

    // --- SPRING-DAMPER JELLY PHYSICS STATE ---
    let wobbleX = 0;
    let wobbleZ = 0;
    let velX = 0;
    let velZ = 0;
    const stiffness = 65.0;
    const damping = 6.8;

    let pokeAmp = 0;
    let pokeTime = 99;
    const pokePos = new THREE.Vector3(0, 3.4, 0);

    const applyImpulse = (ix: number, iz: number, hitX = 0, hitZ = 0) => {
      velX += ix;
      velZ += iz;
      pokeAmp = Math.min(0.35, Math.hypot(ix, iz) * 0.085 + 0.18);
      pokeTime = 0;
      pokePos.set(hitX, 3.4, hitZ);
    };

    pokeTriggerRef.current = () => {
      applyImpulse(
        (Math.random() - 0.5) * 5.0,
        (Math.random() - 0.5) * 5.0,
        (Math.random() - 0.5) * 2.5,
        (Math.random() - 0.5) * 2.5
      );
    };

    // --- LIGHTING TRANSITION (NOON TO MANILA BAY SUNSET) ---
    let sunsetBlend = 0;
    let targetSunset = 0;
    toggleSunsetRef.current = () => {
      targetSunset = targetSunset === 0 ? 1 : 0;
      setIsSunset(targetSunset === 1);
    };

    const colNoonSky = new THREE.Color("#081224");
    const colSunsetSky = new THREE.Color("#1f0724");

    const colNoonSun = new THREE.Color("#fffbeb");
    const colSunsetSun = new THREE.Color("#fb923c");

    const colNoonJelly = new THREE.Color("#06b6d4");
    const colSunsetJelly = new THREE.Color("#044343");

    // --- RAYCASTING FOR INTERACTIVE POKES ---
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };

    const onPointerDown = (e: MouseEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e: MouseEvent) => {
      const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      if (dist > 6) return;

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(jellyMesh, false);
      if (hits.length > 0) {
        const hit = hits[0];
        const pushX = (hit.point.x / 4.8) * 4.0;
        const pushZ = (hit.point.z / 3.2) * 4.0;
        applyImpulse(pushX, pushZ, hit.point.x, hit.point.z);
      }
    };

    const domEl = renderer.domElement;
    domEl.addEventListener("pointerdown", onPointerDown);
    domEl.addEventListener("pointerup", onPointerUp);

    // --- RESIZE OBSERVER ---
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        const height = entry.contentRect.height;
        if (width === 0 || height === 0) return;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
      }
    });
    resizeObserver.observe(container);

    // --- ANIMATION LOOP ---
    let lastTime = performance.now();
    let frameCount = 0;
    let fpsTimer = 0;
    let animationFrameId = 0;

    const animate = (now: number) => {
      animationFrameId = requestAnimationFrame(animate);
      const dt = Math.min((now - lastTime) * 0.001, 0.05);
      lastTime = now;

      frameCount++;
      fpsTimer += dt;
      if (fpsTimer >= 0.5) {
        setFps(Math.round(frameCount / fpsTimer));
        frameCount = 0;
        fpsTimer = 0;
      }

      // Physics solver for wobble
      const fx = -stiffness * wobbleX - damping * velX;
      const fz = -stiffness * wobbleZ - damping * velZ;
      velX += fx * dt;
      velZ += fz * dt;
      wobbleX += velX * dt;
      wobbleZ += velZ * dt;

      // Decay poke ripple
      if (pokeTime < 3.2) {
        pokeTime += dt;
      }

      // Jelly energy readout
      const energy = Math.hypot(wobbleX, wobbleZ) + (pokeTime < 3.2 ? pokeAmp * (1 - pokeTime / 3.2) : 0);
      setJellyEnergy(parseFloat((energy * 10).toFixed(1)));

      // Update shader uniforms
      jellyUniforms.uTime.value = now * 0.001;
      jellyUniforms.uWobbleX.value = wobbleX;
      jellyUniforms.uWobbleZ.value = wobbleZ;
      jellyUniforms.uPokePos.value.copy(pokePos);
      jellyUniforms.uPokeAmp.value = pokeAmp;
      jellyUniforms.uPokeTime.value = pokeTime;

      // Smooth camera preset lerp
      camera.position.lerp(targetCamPos, 0.05);
      controls.target.lerp(targetLookAt, 0.05);

      // Sunset lerp
      sunsetBlend += (targetSunset - sunsetBlend) * 0.04;
      scene.background = colNoonSky.clone().lerp(colSunsetSky, sunsetBlend);
      skyMat.color.lerpColors(colNoonSky, colSunsetSky, sunsetBlend);

      sunLight.color.lerpColors(colNoonSun, colSunsetSun, sunsetBlend);
      sunLight.intensity = THREE.MathUtils.lerp(2.6, 1.45, sunsetBlend);
      sunLight.position.y = THREE.MathUtils.lerp(11.5, 3.6, sunsetBlend);
      sunLight.position.x = THREE.MathUtils.lerp(7.5, 10.5, sunsetBlend);

      jellyMat.attenuationColor.lerpColors(colNoonJelly, colSunsetJelly, sunsetBlend);

      // Evening point light intensities
      kuboLight.intensity = THREE.MathUtils.lerp(0.3, 1.6, sunsetBlend);
      ferryLight.intensity = THREE.MathUtils.lerp(0.2, 1.8, sunsetBlend);
      parolaBeacon.intensity = THREE.MathUtils.lerp(0.8, 3.4, sunsetBlend);
      beamMat.opacity = THREE.MathUtils.lerp(0.24, 0.76, sunsetBlend);

      // Rotate Parola volumetric light beam
      lightBeam.rotation.z += dt * 1.4;

      // Animate swaying seagrass
      const timeSec = now * 0.001;
      seagrassList.forEach((sg) => {
        sg.mesh.rotation.z = sg.baseRotationZ + Math.sin(timeSec * sg.freq + sg.phase) * sg.swayAmp;
      });

      // Animate rising bubbles
      bubbles.forEach((b) => {
        b.mesh.position.y += b.speed * dt;
        b.mesh.position.x += Math.sin(timeSec * b.wobbleSpeed + b.wobbleOffset) * 0.003;
        if (b.mesh.position.y > b.maxY) {
          b.mesh.position.y = b.resetY;
        }
      });

      // Animate tropical reef fish schooling
      fishList.forEach((f) => {
        f.angle += f.speed * dt;
        const fx = Math.cos(f.angle) * f.orbitRadius;
        const fz = Math.sin(f.angle) * f.orbitRadius;
        const fDisp = sampleJellyDisplacement(
          fx,
          f.baseY,
          fz,
          timeSec,
          wobbleX,
          wobbleZ,
          pokePos,
          pokeAmp,
          pokeTime
        );
        f.group.position.set(
          fx + fDisp.dx,
          f.baseY + Math.sin(timeSec * 2.0 + f.phase) * f.verticalAmp + fDisp.dy,
          fz + fDisp.dz
        );
        f.group.rotation.y = -f.angle + Math.PI * 0.5;
        f.tail.rotation.y = Math.sin(timeSec * f.swimFreq) * 0.38;
        f.finL.rotation.y = 0.5 + Math.sin(timeSec * f.swimFreq * 0.5) * 0.2;
        f.finR.rotation.y = -0.5 - Math.sin(timeSec * f.swimFreq * 0.5) * 0.2;
      });

      // Animate Sea Turtle (Pawikan) gracefully gliding across central lagoon
      const turtleAngle = timeSec * 0.22;
      const tX = 0.7 + Math.cos(turtleAngle) * 2.1;
      const tZ = 0.2 + Math.sin(turtleAngle) * 1.6;
      const tDisp = sampleJellyDisplacement(
        tX,
        1.6,
        tZ,
        timeSec,
        wobbleX,
        wobbleZ,
        pokePos,
        pokeAmp,
        pokeTime
      );
      pawikan.position.set(
        tX + tDisp.dx,
        1.6 + Math.sin(timeSec * 0.5) * 0.22 + tDisp.dy,
        tZ + tDisp.dz
      );
      pawikan.rotation.y = -turtleAngle + Math.PI * 0.5;
      flipperFL.rotation.z = Math.sin(timeSec * 1.8) * 0.32;
      flipperFR.rotation.z = -Math.sin(timeSec * 1.8) * 0.32;

      // Animate Pantalan Pier Boardwalk subtle physical wobble sync (West side x = -2.8)
      const pierDisp = sampleJellyDisplacement(
        -2.8,
        3.48,
        0.2,
        timeSec,
        wobbleX,
        wobbleZ,
        pokePos,
        pokeAmp,
        pokeTime
      );
      pierGroup.position.set(-2.8 + pierDisp.dx * 0.85, 3.48 + pierDisp.dy * 0.85, 0.2 + pierDisp.dz * 0.85);
      pierGroup.rotation.z = wobbleX * 0.035;
      pierGroup.rotation.x = wobbleZ * 0.035;

      // Animate Cruising Bangka with rotating propeller & boat wake circling lagoon
      cruisingData.t += dt * cruisingData.speed;
      const bX = Math.cos(cruisingData.t) * 2.1 + 0.5;
      const bZ = Math.sin(cruisingData.t) * 1.5 + 0.1;
      const bDisp = sampleJellyDisplacement(
        bX,
        3.4,
        bZ,
        timeSec,
        wobbleX,
        wobbleZ,
        pokePos,
        pokeAmp,
        pokeTime
      );
      cruisingData.group.position.set(bX + bDisp.dx, 3.42 + bDisp.dy, bZ + bDisp.dz);
      cruisingData.group.rotation.y = -cruisingData.t + Math.PI * 0.5;
      cruisingData.group.rotation.z = Math.sin(timeSec * 3.2) * 0.045 + wobbleX * 0.06;
      cruisingData.propeller.rotation.x += dt * 32.0;

      // Align surface wake
      cruisingData.wakeGroup.position.set(bX + bDisp.dx, 3.41 + bDisp.dy, bZ + bDisp.dz);
      cruisingData.wakeGroup.rotation.y = -cruisingData.t + Math.PI * 0.5;

      // Animate Moored Ro-Ro Ferry Berthed Alongside Wharf (x = -0.95)
      const roroDisp = sampleJellyDisplacement(
        -0.95,
        3.4,
        -0.3,
        timeSec,
        wobbleX,
        wobbleZ,
        pokePos,
        pokeAmp,
        pokeTime
      );
      roroGroup.position.set(-0.95 + roroDisp.dx, 3.42 + roroDisp.dy, -0.3 + roroDisp.dz);
      roroGroup.rotation.z = Math.sin(timeSec * 1.4) * 0.015 + wobbleX * 0.035;
      roroGroup.rotation.x = Math.cos(timeSec * 1.2) * 0.015 + wobbleZ * 0.035;

      // Rotate Ship Navigation Radar Scanner Bar
      ferryRadarScanner.rotation.y += dt * 3.2;

      // Animate Moored Bangka by Pier Pilings
      const mooredDisp = sampleJellyDisplacement(
        -1.25,
        3.4,
        1.7,
        timeSec,
        wobbleX,
        wobbleZ,
        pokePos,
        pokeAmp,
        pokeTime
      );
      mooredBangka.position.set(-1.25 + mooredDisp.dx, 3.42 + mooredDisp.dy, 1.7 + mooredDisp.dz);
      mooredBangka.rotation.z = Math.sin(timeSec * 2.2) * 0.035 + wobbleX * 0.04;

      // Animate Stilt Fisherman's Hut (Bahay Kubo sa Laot at x = 2.4, z = 1.4)
      const stiltDisp = sampleJellyDisplacement(
        2.4,
        3.42,
        1.4,
        timeSec,
        wobbleX,
        wobbleZ,
        pokePos,
        pokeAmp,
        pokeTime
      );
      stiltHutGroup.position.set(2.4 + stiltDisp.dx * 0.85, 3.42 + stiltDisp.dy * 0.85, 1.4 + stiltDisp.dz * 0.85);
      stiltHutGroup.rotation.z = wobbleX * 0.025;
      stiltHutGroup.rotation.x = wobbleZ * 0.025;

      // Animate Sandbar Islet & Palms (x = 3.5, z = 0.55)
      const sandbarDisp = sampleJellyDisplacement(
        3.5,
        3.4,
        0.55,
        timeSec,
        wobbleX,
        wobbleZ,
        pokePos,
        pokeAmp,
        pokeTime
      );
      sandbarGroup.position.set(3.5 + sandbarDisp.dx * 0.9, 3.4 + sandbarDisp.dy * 0.9, 0.55 + sandbarDisp.dz * 0.9);
      sandbarGroup.rotation.z = wobbleX * 0.02;
      sandbarGroup.rotation.x = wobbleZ * 0.02;

      // Animate Sailing Paraw with wind swell & billowing layag sail (x = 3.6, z = -0.45)
      const parawDisp = sampleJellyDisplacement(
        3.6,
        3.42,
        -0.45,
        timeSec,
        wobbleX,
        wobbleZ,
        pokePos,
        pokeAmp,
        pokeTime
      );
      parawGroup.position.set(3.6 + parawDisp.dx, 3.42 + parawDisp.dy, -0.45 + parawDisp.dz);
      parawGroup.rotation.z = Math.sin(timeSec * 2.0) * 0.035 + wobbleX * 0.04;
      parawGroup.rotation.x = Math.cos(timeSec * 1.6) * 0.025 + wobbleZ * 0.04;
      parawSail.rotation.y = Math.sin(timeSec * 2.8) * 0.05;

      // Animate Realistic Coconut Palm Fronds Swaying in Tropical Sea Breeze
      allPalmFronds.forEach((frond, idx) => {
        frond.rotation.z = Math.sin(timeSec * 2.2 + idx * 0.45) * 0.032;
        frond.rotation.x += Math.cos(timeSec * 1.8 + idx * 0.35) * 0.0006;
      });

      // Animate Coastal Birds (Tagak)
      birds.forEach((b) => {
        b.angle += b.speed * dt * 0.4;
        const bx = Math.cos(b.angle) * b.orbitRadius;
        const bz = Math.sin(b.angle) * b.orbitRadius;
        b.group.position.set(bx, b.baseY + Math.sin(b.angle * 2.0) * 0.28, bz);
        b.group.rotation.y = -b.angle + Math.PI * 0.5;
        b.group.rotation.z = -b.bankFactor;

        const flap = Math.sin(timeSec * b.flapSpeed) * 0.44;
        b.wingLeft.rotation.z = flap;
        b.wingRight.rotation.z = -flap;
      });

      controls.update();
      renderer.render(scene, camera);
    };

    animationFrameId = requestAnimationFrame(animate);

    // --- CLEANUP & FULL MEMORY/WEBGL DISPOSAL ---
    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      domEl.removeEventListener("pointerdown", onPointerDown);
      domEl.removeEventListener("pointerup", onPointerUp);

      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else {
            obj.material?.dispose();
          }
        }
      });

      woodTexture.dispose();
      pierPlanksTexture.dispose();
      wharfConcreteTexture.dispose();
      ferryTexture.dispose();
      coralStoneTexture.dispose();
      jeepneyTexture.dispose();
      balikbayanTexture.dispose();
      causticTexture.dispose();
      parawSailTexture.dispose();
      plaqueTexture.dispose();
      palmBarkTexture.dispose();
      palmFrondTexture.dispose();

      pmremGenerator.dispose();
      controls.dispose();
      renderer.dispose();
      renderer.forceContextLoss();

      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  const handlePoke = useCallback(() => {
    if (pokeTriggerRef.current) {
      pokeTriggerRef.current();
    }
  }, []);

  const handleToggleLighting = useCallback(() => {
    if (toggleSunsetRef.current) {
      toggleSunsetRef.current();
    }
  }, []);

  const handlePresetSelect = useCallback((preset: CameraPreset) => {
    if (setPresetRef.current) {
      setPresetRef.current(preset);
    }
  }, []);

  return (
    <div className="relative w-full h-screen bg-[#081224] overflow-hidden select-none font-sans">
      {/* 3D WebGL Canvas Container */}
      <div ref={containerRef} className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing" />

      {/* Glassmorphic Minimal HUD Overlay */}
      <div className="absolute top-5 left-5 z-20 pointer-events-none flex flex-col gap-3">
        {/* Title Header Card */}
        <div className="pointer-events-auto backdrop-blur-md bg-slate-900/80 border border-white/10 rounded-2xl px-5 py-4 shadow-2xl max-w-sm transition-all hover:bg-slate-900/90">
          <div className="flex items-center justify-between gap-3 mb-1">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
              <h1 className="text-base font-semibold tracking-wide text-white">Pantalan Jelly</h1>
            </div>
            <span className="text-[11px] font-medium tracking-wider px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-400/20 uppercase">
              Realistic Philippine Port
            </span>
          </div>

          <p className="text-xs text-slate-300/80 leading-relaxed">
            Procedural realistic sea jelly diorama harboring a miniature Philippine island port with inter-island Ro-Ro ferry, outrigger bangkas with boat wake, Palawan coral reef with animated caustics, and an authentic jeepney pier.
          </p>

          {/* Engineer Attribution Badge */}
          <div className="mt-2.5 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-950/70 border border-cyan-400/30 text-[11px] text-cyan-200 w-fit">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            <span>Engineered by <strong className="text-white font-semibold tracking-wide">Dylan Ramos</strong></span>
          </div>

          {/* Real-time telemetry tags */}
          <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between text-[11px] text-slate-400">
            <div className="flex items-center gap-2">
              <span>Jelly Energy:</span>
              <span className="font-mono text-cyan-400">{jellyEnergy.toFixed(1)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span>FPS:</span>
              <span className="font-mono text-emerald-400">{fps}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              <span className="text-slate-300 font-medium">{isSunset ? "Manila Bay Sunset" : "Noon Sun"}</span>
            </div>
          </div>
        </div>

        {/* Camera Presets Selector */}
        <div className="pointer-events-auto backdrop-blur-md bg-slate-950/65 border border-white/10 rounded-xl p-1.5 flex items-center gap-1 shadow-lg w-fit">
          {(
            [
              { id: "overview", label: "Overview" },
              { id: "pier", label: "Pantalan" },
              { id: "reef", label: "Reef & Clam" },
              { id: "parola", label: "Parola" },
              { id: "sandbar", label: "Sandbar & Paraw" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              onClick={() => handlePresetSelect(item.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                activePreset === item.id
                  ? "bg-cyan-500/25 text-cyan-300 border border-cyan-400/30 shadow-sm"
                  : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Interaction Hint Pill */}
        <div className="pointer-events-auto backdrop-blur-md bg-slate-950/60 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-slate-300 flex items-center gap-2.5 shadow-lg w-fit">
          <svg className="w-4 h-4 text-cyan-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
          </svg>
          <span>Click anywhere on the jelly block to poke radial ripple waves</span>
        </div>
      </div>

      {/* Floating Control Buttons */}
      <div className="absolute bottom-6 right-6 z-20 flex flex-col sm:flex-row items-end sm:items-center gap-3">
        {/* Poke Impulse Button */}
        <button
          onClick={handlePoke}
          className="group relative flex items-center gap-2 px-4 py-2.5 rounded-xl backdrop-blur-md bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-400/30 hover:border-cyan-400/60 shadow-lg text-xs font-medium tracking-wide transition-all active:scale-95"
        >
          <span className="w-2 h-2 rounded-full bg-cyan-400 group-hover:scale-125 transition-transform" />
          <span>Poke Jelly</span>
        </button>

        {/* Lighting Mode Toggle Button */}
        <button
          onClick={handleToggleLighting}
          className={`group flex items-center gap-2.5 px-4 py-2.5 rounded-xl backdrop-blur-md border shadow-lg text-xs font-medium tracking-wide transition-all active:scale-95 ${
            isSunset
              ? "bg-amber-500/25 hover:bg-amber-500/35 text-amber-200 border-amber-400/40 hover:border-amber-400/70"
              : "bg-slate-900/80 hover:bg-slate-800/90 text-slate-200 border-white/10 hover:border-white/20"
          }`}
        >
          {isSunset ? (
            <svg className="w-4 h-4 text-amber-400 group-hover:rotate-12 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-amber-300 group-hover:rotate-45 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          )}
          <span>{isSunset ? "Switch to Noon Sun" : "Manila Bay Sunset"}</span>
        </button>
      </div>

      {/* Cultural Miniature Legend Badge (Bottom Left) */}
      <div className="absolute bottom-6 left-6 z-20 hidden md:flex items-center gap-2 backdrop-blur-md bg-slate-950/50 border border-white/10 rounded-xl px-3.5 py-2 text-[11px] text-slate-400">
        <span className="text-cyan-300 font-semibold tracking-wide">Engineered by Dylan Ramos</span>
        <span className="text-slate-600">•</span>
        <span className="text-slate-200 font-medium">Archipelago Panorama:</span>
        <span className="text-cyan-300">Ro-Ro Ferry</span>
        <span className="text-slate-600">•</span>
        <span className="text-amber-300">Bangka & Paraw</span>
        <span className="text-slate-600">•</span>
        <span className="text-emerald-300">Pawikan & Caustics</span>
        <span className="text-slate-600">•</span>
        <span className="text-rose-300">Sarao Jeepney</span>
        <span className="text-slate-600">•</span>
        <span className="text-yellow-300">Stilt Hut & Sandbar</span>
        <span className="text-slate-600">•</span>
        <span className="text-indigo-300">Spanish Parola</span>
      </div>
    </div>
  );
}
