const preventZoom = (event) => {
  event.preventDefault();
};

["gesturestart", "gesturechange", "gestureend"].forEach((eventName) => {
  document.addEventListener(eventName, preventZoom, { passive: false });
});

document.addEventListener(
  "touchmove",
  (event) => {
    if (event.touches && event.touches.length > 1) preventZoom(event);
  },
  { passive: false },
);

document.addEventListener("dblclick", preventZoom, { passive: false });
