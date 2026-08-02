'use client';

function MosaicCard({ type }: { type: string }) {
  if (type === 'mc-4')
    return (
      <div className="m-card mc-4">
        <div className="mc-pad">
          <div className="mc-title">Compare prices<br />in seconds</div>
          <div className="mc-ui">
            <div className="mc-input" />
            <div className="mc-btn-row">
              <div className="mc-btn">Create account</div>
              <div className="mc-btn ghost">Sign in</div>
            </div>
          </div>
        </div>
      </div>
    );
  if (type === 'mc-1')
    return (
      <div className="m-card mc-1">
        <div className="mc-pad">
          <div className="mc-row">
            <span className="mc-dot" /><span className="mc-dot" /><span className="mc-dot" /><span className="mc-dot" />
          </div>
          <div className="mc-label muted" style={{ marginTop: '0.5vw' }}>Shop by category</div>
          <div className="mc-swatch" />
          <div className="mc-label" style={{ marginTop: '0.5vw' }}>Recommended for you</div>
        </div>
      </div>
    );
  if (type === 'mc-5')
    return (
      <div className="m-card mc-5">
        <div className="mc-pad">
          <div className="mc-label muted">ACME</div>
          <div className="mc-price">$184.20</div>
          <div className="mc-change">&#9660; 2.41%</div>
          <svg viewBox="0 0 100 40" preserveAspectRatio="none">
            <polyline points="0,28 12,22 24,30 36,14 48,20 60,8 72,16 84,6 100,12" fill="none" stroke="#fff" strokeWidth="2" />
          </svg>
          <div className="mc-btn-row">
            <div className="mc-btn buy">Buy</div>
            <div className="mc-btn">Sell</div>
          </div>
        </div>
      </div>
    );
  if (type === 'mc-7')
    return (
      <div className="m-card mc-7">
        <div className="mc-pad">
          <div className="mc-title">MIDNIGHT<br />HOLLOW</div>
          <div className="mc-label">Now streaming</div>
        </div>
      </div>
    );
  if (type === 'mc-2')
    return (
      <div className="m-card mc-2">
        <div className="mc-pad">
          <div className="mc-title">Heirloom<br />Tomato Tart</div>
          <div className="mc-label">A rustic bake with charred crust</div>
        </div>
      </div>
    );
  if (type === 'mc-3')
    return (
      <div className="m-card mc-3">
        <div className="mc-pad">
          <div className="mc-label">Nearby spots</div>
          <div className="mc-map"><span className="mc-pin" /></div>
        </div>
      </div>
    );
  if (type === 'mc-6')
    return (
      <div className="m-card mc-6">
        <div className="mc-pad">
          <div className="mc-title">Daily Focus</div>
          <div className="mc-label">Session 1 of 8</div>
          <div className="mc-play" />
        </div>
      </div>
    );
  if (type === 'mc-8')
    return (
      <div className="m-card mc-8">
        <div className="mc-pad">
          <div className="mc-bookmark" />
          <div className="mc-title">Save what<br />inspires you</div>
        </div>
      </div>
    );
  if (type === 'mc-9')
    return (
      <div className="m-card mc-9">
        <div className="mc-pad">
          <div className="mc-time">10:46</div>
          <div className="mc-label muted">No meetings today</div>
          <div className="mc-divider" />
          <div className="mc-bar" />
          <div className="mc-bar" style={{ width: '40%' }} />
        </div>
      </div>
    );
  if (type === 'mc-10')
    return (
      <div className="m-card mc-10">
        <div className="mc-pad">
          <div className="mc-label muted">Saved items</div>
          <div className="mc-grid4">
            <div className="g1" /><div className="g2" /><div className="g3" /><div className="g4" />
          </div>
        </div>
      </div>
    );
  if (type === 'mc-11')
    return (
      <div className="m-card mc-11">
        <div className="mc-pad">
          <div className="mc-label">Abuja</div>
          <div className="mc-temp">72&deg;</div>
          <div className="mc-label">Partly cloudy</div>
        </div>
      </div>
    );
  if (type === 'mc-12')
    return (
      <div className="m-card mc-12">
        <div className="mc-pad">
          <div className="mc-art" />
          <div className="mc-bar" />
          <div className="mc-bar short" />
        </div>
      </div>
    );
  return null;
}

export function BrandPanel() {
  const col1 = ['mc-4', 'mc-1', 'mc-5', 'mc-7', 'mc-2', 'mc-4', 'mc-1', 'mc-5', 'mc-7', 'mc-2'];
  const col2 = ['mc-3', 'mc-12', 'mc-6', 'mc-1', 'mc-5', 'mc-3', 'mc-12', 'mc-6', 'mc-1', 'mc-5'];
  const col3 = ['mc-9', 'mc-7', 'mc-3', 'mc-6', 'mc-11', 'mc-9', 'mc-7', 'mc-3', 'mc-6', 'mc-11'];
  const col4 = ['mc-8', 'mc-5', 'mc-2', 'mc-10', 'mc-4', 'mc-8', 'mc-5', 'mc-2', 'mc-10', 'mc-4'];
  const col5 = ['mc-1', 'mc-9', 'mc-12', 'mc-4', 'mc-7', 'mc-1', 'mc-9', 'mc-12', 'mc-4', 'mc-7'];
  const col6 = ['mc-10', 'mc-2', 'mc-8', 'mc-6', 'mc-3', 'mc-10', 'mc-2', 'mc-8', 'mc-6', 'mc-3'];

  return (
    <div className="brand-panel">
      <div className="mosaic-wrap">
        <div className="mosaic-track">
          <div className="mosaic-col dir-up c1">{col1.map((t, i) => <MosaicCard key={i} type={t} />)}</div>
          <div className="mosaic-col dir-down c2">{col2.map((t, i) => <MosaicCard key={i} type={t} />)}</div>
          <div className="mosaic-col dir-up c3">{col3.map((t, i) => <MosaicCard key={i} type={t} />)}</div>
          <div className="mosaic-col dir-down c4">{col4.map((t, i) => <MosaicCard key={i} type={t} />)}</div>
          <div className="mosaic-col dir-up c5">{col5.map((t, i) => <MosaicCard key={i} type={t} />)}</div>
          <div className="mosaic-col dir-down c6">{col6.map((t, i) => <MosaicCard key={i} type={t} />)}</div>
        </div>
      </div>
    </div>
  );
}
