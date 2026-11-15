export function openShotLightbox(shot: HTMLElement) {
  const lb = document.createElement("div");
  lb.id = "lb";
  const img = document.createElement("img");
  img.src = shot.dataset.shot || "";
  img.alt = "";
  lb.append(img);
  if (shot.dataset.cap) {
    const p = document.createElement("p");
    p.textContent = shot.dataset.cap;
    lb.append(p);
  }
  document.body.appendChild(lb);
  requestAnimationFrame(() => lb.classList.add("on"));
}
