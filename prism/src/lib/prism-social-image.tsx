import React from "react";
import { ImageResponse } from "next/og";

export const socialImageSize = {
  width: 1200,
  height: 630,
};

export const socialImageContentType = "image/png";

export function createPrismSocialImageResponse() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          background: "#020202",
          position: "relative",
        }}
      >
        <svg
          width="1200"
          height="630"
          viewBox="0 0 1200 630"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect width="1200" height="630" fill="#020202" />
          <g opacity="0.18">
            <circle cx="160" cy="140" r="1.4" fill="#ffffff" />
            <circle cx="274" cy="88" r="1.2" fill="#ffffff" />
            <circle cx="1012" cy="112" r="1.2" fill="#ffffff" />
            <circle cx="922" cy="208" r="1.4" fill="#ffffff" />
            <circle cx="174" cy="456" r="1.2" fill="#ffffff" />
            <circle cx="1114" cy="428" r="1.2" fill="#ffffff" />
          </g>

          <defs>
            <linearGradient id="beamWhite" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#b8c9d6" />
              <stop offset="58%" stopColor="#f7fbff" />
              <stop offset="100%" stopColor="#fff5eb" />
            </linearGradient>
            <linearGradient id="prismEdge" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#eaf7ff" />
              <stop offset="45%" stopColor="#8fb8d8" />
              <stop offset="100%" stopColor="#ffffff" />
            </linearGradient>
            <linearGradient id="prismFill" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="rgba(219,241,255,0.22)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0.03)" />
            </linearGradient>
            <linearGradient id="rainbow" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#ff3a2e" />
              <stop offset="17%" stopColor="#ff8b00" />
              <stop offset="34%" stopColor="#ffe500" />
              <stop offset="51%" stopColor="#38d16a" />
              <stop offset="68%" stopColor="#17a8ff" />
              <stop offset="84%" stopColor="#2d63ff" />
              <stop offset="100%" stopColor="#8e38ff" />
            </linearGradient>
            <filter id="softGlow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="8" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <path
            d="M0 365L498 276"
            stroke="url(#beamWhite)"
            strokeWidth="4"
            strokeLinecap="round"
            filter="url(#softGlow)"
          />

          <path
            d="M498 276L1005 232"
            stroke="url(#rainbow)"
            strokeWidth="18"
            strokeLinecap="round"
            opacity="0.95"
            filter="url(#softGlow)"
          />
          <path
            d="M500 287L1022 280"
            stroke="url(#rainbow)"
            strokeWidth="16"
            strokeLinecap="round"
            opacity="0.88"
            filter="url(#softGlow)"
          />
          <path
            d="M501 299L1040 330"
            stroke="url(#rainbow)"
            strokeWidth="14"
            strokeLinecap="round"
            opacity="0.8"
            filter="url(#softGlow)"
          />

          <path
            d="M377 458L600 150L823 458H377Z"
            fill="url(#prismFill)"
            stroke="url(#prismEdge)"
            strokeWidth="4"
            filter="url(#softGlow)"
          />

          <path d="M377 458L600 150" stroke="url(#prismEdge)" strokeWidth="3" opacity="0.95" />
          <path d="M600 150L823 458" stroke="url(#prismEdge)" strokeWidth="3" opacity="0.95" />
          <path d="M377 458H823" stroke="url(#prismEdge)" strokeWidth="3" opacity="0.95" />

          <path
            d="M499 276L708 255L598 312L499 276Z"
            fill="rgba(255,255,255,0.12)"
            stroke="rgba(255,255,255,0.18)"
            strokeWidth="1.5"
          />

          <ellipse cx="485" cy="489" rx="56" ry="14" fill="rgba(169, 214, 255, 0.14)" />
        </svg>
        <div
          style={{
            position: "absolute",
            top: 72,
            left: 90,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div
            style={{
              color: "rgba(255,255,255,0.92)",
              fontSize: 56,
              letterSpacing: "0.28em",
              textTransform: "uppercase",
              fontFamily: "Helvetica, Arial, sans-serif",
            }}
          >
            PRISM
          </div>
          <div
            style={{
              color: "rgba(255,255,255,0.48)",
              fontSize: 18,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              fontFamily: "Helvetica, Arial, sans-serif",
            }}
          >
            AI-guided clarification workspace
          </div>
        </div>
      </div>
    ),
    socialImageSize
  );
}
