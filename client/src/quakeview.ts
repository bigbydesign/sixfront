/**
 * Match view: Quake-quality FPS engine branded as Big Hersh House.
 * Engine assets: /sixfront/quake/ (Quake1 / WebQuake lineage — see NOTICE.txt).
 */
import type { Session } from "./net";

export class QuakeView {
  session: Session;
  private root: HTMLElement;
  private frame: HTMLIFrameElement;

  constructor(session: Session, parent: HTMLElement) {
    this.session = session;
    parent.replaceChildren();

    this.root = document.createElement("div");
    this.root.className = "quake1-root";
    parent.appendChild(this.root);

    const bar = document.createElement("div");
    bar.className = "quake1-chrome";
    bar.innerHTML = `
      <span class="quake1-brand">BIG HERSH HOUSE</span>
      <span class="quake1-hint">Click the game to play · Esc for menu</span>
      <button type="button" id="quake1-leave">Leave</button>`;
    this.root.appendChild(bar);

    this.frame = document.createElement("iframe");
    this.frame.className = "quake1-frame";
    this.frame.title = "Big Hersh House";
    this.frame.allow = "autoplay; fullscreen; gamepad; pointer-lock";
    this.frame.setAttribute("allowfullscreen", "true");
    // Skip demos — drop straight into shareware episode 1 (Quake-quality match)
    this.frame.src = `/sixfront/quake/Quake1Game.htm?+map%20e1m1`;
    this.root.appendChild(this.frame);

    bar.querySelector("#quake1-leave")?.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("hersh:leave-quake"));
    });

    this.frame.addEventListener("load", () => {
      try {
        this.frame.contentWindow?.focus();
      } catch {
        /* ignore */
      }
    });
  }

  destroy(): void {
    this.frame.src = "about:blank";
    this.root.remove();
  }

  get midX(): number {
    return 0;
  }

  tracer(_x: number, _y: number, _x2: number, _y2: number): void {}
  radarPing(_x: number, _y: number): void {}
  burst(_x: number, _y: number): void {}
  onShotFeedback(): void {}
}
