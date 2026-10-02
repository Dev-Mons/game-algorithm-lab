import * as THREE from 'three';

/** 캔버스 텍스처 라벨. 공정 번호·이름·방향을 표시한다. 텍스처는 라벨마다 한 번만 만든다. */
export function makeLabel(title: string, sub = '', accent = '#f0a050', worldHeight = 1.1): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = '600 44px "IBM Plex Sans KR", "Malgun Gothic", sans-serif', subFont = '400 30px "IBM Plex Sans KR", "Malgun Gothic", sans-serif';
  ctx.font = font;
  const w1 = ctx.measureText(title).width;
  ctx.font = subFont;
  const w2 = sub ? ctx.measureText(sub).width : 0;
  const width = Math.ceil(Math.max(w1, w2) + 56), height = sub ? 118 : 76;
  canvas.width = width; canvas.height = height;
  ctx.fillStyle = 'rgba(24,30,34,0.86)';
  ctx.beginPath(); ctx.roundRect(0, 0, width, height, 12); ctx.fill();
  ctx.fillStyle = accent; ctx.fillRect(0, 0, 10, height);
  ctx.fillStyle = '#f4efe6'; ctx.font = font; ctx.textBaseline = 'top'; ctx.fillText(title, 28, 14);
  if (sub) { ctx.fillStyle = '#b9c2c6'; ctx.font = subFont; ctx.fillText(sub, 28, 70); }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 2;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false, transparent: true }));
  sprite.scale.set(worldHeight * width / height, worldHeight, 1);
  sprite.renderOrder = 10;
  return sprite;
}

/** 값이 바뀔 때만 다시 그리는 동적 숫자 라벨. */
export class LiveLabel {
  readonly sprite: THREE.Sprite;
  private readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d')!;
  private readonly texture: THREE.CanvasTexture;
  private last = '';
  constructor(private readonly accent: string, worldHeight = 0.8) {
    this.canvas.width = 320; this.canvas.height = 72;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, depthWrite: false, transparent: true }));
    this.sprite.scale.set(worldHeight * 320 / 72, worldHeight, 1);
    this.sprite.renderOrder = 11;
  }
  set(text: string) {
    if (text === this.last) return;
    this.last = text;
    const c = this.ctx;
    c.clearRect(0, 0, 320, 72);
    c.fillStyle = 'rgba(16,20,22,0.82)'; c.beginPath(); c.roundRect(0, 0, 320, 72, 10); c.fill();
    c.fillStyle = this.accent; c.font = '600 38px "Space Grotesk", "IBM Plex Sans KR", sans-serif'; c.textBaseline = 'middle'; c.textAlign = 'center';
    c.fillText(text, 160, 38);
    this.texture.needsUpdate = true;
  }
}
