# Draws the locco app icon (option 6, "Petal") as SVGs on Apple's macOS icon grid:
# 1024 canvas, 824 rounded-square body, symbol ≈ 61% of the body. Run: python3 design/make-icon.py
# Also writes locco-icon-small.svg with a wider gap, used for the 16 and 32 px sizes so the cross still reads.
S, BODY = 1024, 824
C = S / 2

def body_path(size=BODY, radius=185):
    # Apple's macOS icon body: an 824 px rounded square with ~22.5% corners, centred on the 1024 canvas.
    x0, x1 = C - size / 2, C + size / 2
    r = radius
    return (f'M{x0 + r},{x0} H{x1 - r} A{r},{r} 0 0 1 {x1},{x0 + r} V{x1 - r} A{r},{r} 0 0 1 {x1 - r},{x1} '
            f'H{x0 + r} A{r},{r} 0 0 1 {x0},{x1 - r} V{x0 + r} A{r},{r} 0 0 1 {x0 + r},{x0} Z')

def icon(GAP):
    # One petal (top-left): three round outer corners, a nearly sharp corner facing the centre.
    P, R, RI = 242, 104, 10   # petal size, outer radius, inner radius
    x0 = y0 = C - GAP / 2 - P
    x1 = y1 = x0 + P
    petal = (f'M{x0 + R},{y0} H{x1 - R} A{R},{R} 0 0 1 {x1},{y0 + R} V{y1 - RI} A{RI},{RI} 0 0 1 {x1 - RI},{y1} '
             f'H{x0 + R} A{R},{R} 0 0 1 {x0},{y1 - R} V{y0 + R} A{R},{R} 0 0 1 {x0 + R},{y0} Z')

    body = body_path()
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}" viewBox="0 0 {S} {S}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#1D1D20"/>
          <stop offset="1" stop-color="#0C0C0D"/>
        </linearGradient>
        <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.14"/>
          <stop offset="0.35" stop-color="#FFFFFF" stop-opacity="0"/>
        </linearGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000000" flood-opacity="0.35"/>
        </filter>
      </defs>
      <path d="{body}" fill="url(#bg)" filter="url(#shadow)"/>
      <path d="{body}" fill="none" stroke="url(#rim)" stroke-width="3"/>
      <g fill="#F2F2F2">
        <path d="{petal}"/>
        <path d="{petal}" transform="matrix(-1 0 0 1 {S} 0)"/>
        <path d="{petal}" transform="matrix(1 0 0 -1 0 {S})"/>
        <path d="{petal}" transform="matrix(-1 0 0 -1 {S} {S})"/>
      </g>
    </svg>
    '''
    return svg, petal, x0, y0, P



open('design/locco-icon-small.svg', 'w').write(icon(GAP=56)[0])
svg, petal, x0, y0, P = icon(GAP=20)
GAP = 20
open('design/locco-icon.svg', 'w').write(svg)

# The mark alone, for anywhere outside the app icon (README, website, sidebar).
mark = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0} {y0} {2 * P + GAP} {2 * P + GAP}">
  <g fill="currentColor">
    <path d="{petal}"/>
    <path d="{petal}" transform="matrix(-1 0 0 1 {S} 0)"/>
    <path d="{petal}" transform="matrix(1 0 0 -1 0 {S})"/>
    <path d="{petal}" transform="matrix(-1 0 0 -1 {S} {S})"/>
  </g>
</svg>
'''
open('design/locco-mark.svg', 'w').write(mark)
print('wrote design/locco-icon.svg, locco-icon-small.svg and locco-mark.svg')
