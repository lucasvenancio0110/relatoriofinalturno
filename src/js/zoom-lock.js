const preventZoom = (event) => {
  event.preventDefault();
};

// iOS Safari exposes native gesture events for pinch zoom.
['gesturestart', 'gesturechange', 'gestureend'].forEach((eventName) => {
  document.addEventListener(eventName, preventZoom, { passive: false });
});

// Fallback for browsers that do not expose gesture events.
document.addEventListener(
  'touchmove',
  (event) => {
    if (event.touches && event.touches.length > 1) preventZoom(event);
  },
  { passive: false },
);

// Prevent double-click/double-tap zoom while preserving normal single taps.
document.addEventListener('dblclick', preventZoom, { passive: false });

let lastTouchEnd = 0;
document.addEventListener(
  'touchend',
  (event) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) preventZoom(event);
    lastTouchEnd = now;
  },
  { passive: false },
);
