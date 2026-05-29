'use client';
import { use, useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';

interface MD {
  id: string; question: string; yes_price: number; no_price: number;
  condition_id?: string;
  volume_24h: number; liquidity: number; mcap: number; txns: number;
  price_change_5m: number; price_change_1h: number; price_change_6h: number; price_change_24h: number;
  age_hours: number; traders: number; category: string;
  image_url: string|null; platform: string; url: string; end_date?: string;
  outcomes?: { label: string; price: number }[];
}
interface Trade { id: string; wallet: string; side: string; outcome: string; price: number; size: number; total_value: number; timestamp: number; time_ago: string; market_question?: string; }
interface CP { time: number; yes: number; no: number; }

const PL: Record<string,{icon:string;gradient:string;name:string}> = {
  polymarket:{icon:'P',gradient:'from-purple-500 to-violet-600',name:'Polymarket'},
  kalshi:{icon:'K',gradient:'from-emerald-500 to-teal-600',name:'Kalshi'},
  manifold:{icon:'M',gradient:'from-amber-500 to-orange-600',name:'Manifold'},
};
const fmtN = (n:number) => { if(!n||n<=0)return'—';if(n>=1e9)return`$${(n/1e9).toFixed(2)}B`;if(n>=1e6)return`$${(n/1e6).toFixed(1)}M`;if(n>=1e3)return`$${(n/1e3).toFixed(0)}K`;return`$${n.toFixed(0)}`; };
const clsC = (n:number) => n>0?'#26a69a':n<0?'#ef5350':'#64748b';
const init2 = (s:string) => s.toUpperCase().replace(/[^A-Z]/g,'').substring(0,2)||'??';

function MImg({m,sz=32}:{m:MD;sz?:number}) {
  const[err,setErr]=useState(false);
  const P=PL[m.platform]||{gradient:'from-slate-600 to-slate-700',icon:'?'};
  return (
    <div className="relative shrink-0" style={{width:sz,height:sz}}>
      {!err&&m.image_url?<img src={m.image_url} alt="" onError={()=>setErr(true)} className="rounded-full object-cover" style={{width:sz,height:sz,border:'2px solid #0d1117'}} />
      :<div className={`flex items-center justify-center rounded-full bg-gradient-to-br ${P.gradient} font-black text-white`} style={{width:sz,height:sz,border:'2px solid #0d1117',fontSize:sz/3}}>{init2(m.question)}</div>}
      <div className={`absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full bg-gradient-to-br ${P.gradient} font-black text-white shadow-lg`} style={{width:14,height:14,border:'2px solid #0d1117',fontSize:6}}>{P.icon}</div>
    </div>
  );
}

function ProbChart({data,yP,nP}:{data:CP[];yP:number;nP:number}) {
  const cRef=useRef<HTMLCanvasElement>(null),rRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const cv=cRef.current,ct=rRef.current;if(!cv||!ct||data.length<2)return;
    const d=window.devicePixelRatio||1,rc=ct.getBoundingClientRect();
    cv.width=rc.width*d;cv.height=rc.height*d;cv.style.width=rc.width+'px';cv.style.height=rc.height+'px';
    const c=cv.getContext('2d');if(!c)return;c.scale(d,d);
    const w=rc.width,h=rc.height,p={t:20,r:55,b:28,l:8},cw=w-p.l-p.r,ch=h-p.t-p.b;
    const mn=data[0].time,mx=data[data.length-1].time,rg=mx-mn||1;
    const tx=(t:number)=>p.l+((t-mn)/rg)*cw,ty=(v:number)=>p.t+(1-v/100)*ch;
    c.strokeStyle='rgba(255,255,255,0.04)';c.lineWidth=1;
    for(let i=0;i<=100;i+=25){const y=ty(i);c.beginPath();c.moveTo(p.l,y);c.lineTo(p.l+cw,y);c.stroke();c.fillStyle='#475569';c.font='9px monospace';c.textAlign='left';c.fillText(i+'%',p.l+cw+4,y+3);}
    c.beginPath();c.moveTo(tx(data[0].time),ty(data[0].yes));for(let i=1;i<data.length;i++)c.lineTo(tx(data[i].time),ty(data[i].yes));
    c.lineTo(tx(data[data.length-1].time),p.t+ch);c.lineTo(tx(data[0].time),p.t+ch);c.closePath();
    const g=c.createLinearGradient(0,p.t,0,p.t+ch);g.addColorStop(0,'rgba(38,166,154,0.25)');g.addColorStop(1,'rgba(38,166,154,0.02)');c.fillStyle=g;c.fill();
    c.beginPath();c.moveTo(tx(data[0].time),ty(data[0].yes));for(let i=1;i<data.length;i++)c.lineTo(tx(data[i].time),ty(data[i].yes));
    c.strokeStyle='#26a69a';c.lineWidth=2;c.stroke();
    c.beginPath();c.moveTo(tx(data[0].time),ty(data[0].no));for(let i=1;i<data.length;i++)c.lineTo(tx(data[i].time),ty(data[i].no));
    c.lineTo(tx(data[data.length-1].time),p.t+ch);c.lineTo(tx(data[0].time),p.t+ch);c.closePath();
    const g2=c.createLinearGradient(0,p.t,0,p.t+ch);g2.addColorStop(0,'rgba(239,83,80,0.2)');g2.addColorStop(1,'rgba(239,83,80,0.02)');c.fillStyle=g2;c.fill();
    c.beginPath();c.moveTo(tx(data[0].time),ty(data[0].no));for(let i=1;i<data.length;i++)c.lineTo(tx(data[i].time),ty(data[i].no));
    c.strokeStyle='#ef5350';c.lineWidth=2;c.stroke();
    c.font='bold 11px monospace';c.textAlign='left';c.fillStyle='#26a69a';c.fillText('YES '+yP+'%',p.l+cw+4,ty(yP)-6);
    c.fillStyle='#ef5350';c.fillText('NO '+nP+'%',p.l+cw+4,ty(nP)+12);
  },[data,yP,nP]);
  return <div ref={rRef} className="relative h-full w-full"><canvas ref={cRef} className="h-full w-full" /></div>;
}

function TopHoldersDonut({trades}:{trades:Trade[]}) {
  const rows = Object.entries(
    trades.reduce<Record<string, number>>((acc, t) => {
      acc[t.wallet] = (acc[t.wallet] ?? 0) + t.total_value;
      return acc;
    }, {})
  ).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const total = rows.reduce((sum, [, v]) => sum + v, 0) || 1;
  const colors = ['#26a69a','#3b82f6','#f59e0b','#ef5350','#8b5cf6'];
  const gradient = rows.reduce<{ stop: number; segments: string[] }>((acc, [, v], i) => {
    const pct = (v / total) * 100;
    return {
      stop: acc.stop + pct,
      segments: [...acc.segments, `${colors[i]} ${acc.stop}% ${acc.stop + pct}%`],
    };
  }, { stop: 0, segments: [] }).segments.join(',');

  return (
    <div className="rounded-xl p-3" style={{border:'1px solid rgba(255,255,255,0.06)',background:'#131722'}}>
      <div className="mb-3 text-[11px] font-semibold text-white">Top Holders Flow</div>
      <div className="flex items-center gap-3">
        <div className="h-20 w-20 shrink-0 rounded-full" style={{background:`conic-gradient(${gradient || '#263241 0% 100%'})`}}>
          <div className="m-[18px] h-11 w-11 rounded-full bg-[#131722]" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          {rows.length ? rows.map(([wallet, value], i)=>(
            <div key={wallet} className="flex items-center justify-between gap-2 text-[10px]">
              <span className="truncate text-slate-400"><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{background:colors[i]}} />{wallet}</span>
              <span className="font-mono tabular-nums text-white">{fmtN(value)}</span>
            </div>
          )) : <div className="text-[10px] text-slate-500">Waiting for holder flow...</div>}
        </div>
      </div>
    </div>
  );
}

function LiquidityDistributionBar({trades}:{trades:Trade[]}) {
  const totals = trades.reduce((acc, t) => {
    const key = t.total_value >= 1000 ? 'whales' : t.total_value >= 100 ? 'dolphins' : 'fish';
    acc[key] += t.total_value;
    return acc;
  }, { whales: 0, dolphins: 0, fish: 0 });
  const total = totals.whales + totals.dolphins + totals.fish || 1;
  const parts = [
    ['Whales', totals.whales, '#f59e0b'],
    ['Dolphins', totals.dolphins, '#3b82f6'],
    ['Fish', totals.fish, '#26a69a'],
  ] as const;

  return (
    <div className="rounded-xl p-3" style={{border:'1px solid rgba(255,255,255,0.06)',background:'#131722'}}>
      <div className="mb-3 text-[11px] font-semibold text-white">Liquidity Size Split</div>
      <div className="flex h-3 overflow-hidden rounded-full bg-white/[0.04]">
        {parts.map(([label, value, color]) => (
          <div key={label} title={`${label}: ${fmtN(value)}`} style={{width:`${(value/total)*100}%`,background:color}} />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {parts.map(([label, value, color]) => (
          <div key={label} className="text-right">
            <div className="text-[8px] uppercase tracking-wider text-slate-500">{label}</div>
            <div className="font-mono text-[11px] font-bold tabular-nums" style={{color}}>{fmtN(value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LiveLineProfile({data}:{data:CP[]}) {
  const latest = data.at(-1);
  const first = data[0];
  const delta = latest && first ? latest.yes - first.yes : 0;

  return (
    <div className="rounded-xl p-3" style={{border:'1px solid rgba(255,255,255,0.06)',background:'#131722'}}>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[11px] font-semibold text-white">Live Line Profile</div>
        <div className="font-mono text-[10px] tabular-nums" style={{color:clsC(delta)}}>{delta>0?'+':''}{delta.toFixed(1)}%</div>
      </div>
      <div className="flex h-16 items-end gap-1">
        {data.slice(-24).map((p)=>(
          <div key={p.time} className="flex-1 rounded-t bg-emerald-400/70" style={{height:`${Math.max(8, p.yes)}%`}} />
        ))}
      </div>
    </div>
  );
}

function TradingTerminal({yP,nP,liquidity}:{yP:number;nP:number;liquidity:number}) {
  const [side,setSide]=useState<'YES'|'NO'>('YES');
  const [amount,setAmount]=useState('100');
  const amt=Math.max(0,parseFloat(amount)||0);
  const priceCents=side==='YES'?yP:nP;                 // implied probability == price in cents
  const pricePerShare=priceCents/100;                  // dollars per share
  const shares=pricePerShare>0?amt/pricePerShare:0;
  const maxPayout=shares;                              // each winning share settles at $1
  const profit=maxPayout-amt;
  const roi=amt>0?(profit/amt)*100:0;
  // Slippage grows with order size relative to pool liquidity.
  const liq=Math.max(1,liquidity);
  const slippage=Math.min(18,(amt/liq)*100*1.4);
  const fillPrice=Math.min(99.5,priceCents*(1+slippage/100));
  const accent=side==='YES'?'#26a69a':'#ef5350';

  const QUICK=[50,100,500,1000];
  return (
    <div className="rounded-xl p-3" style={{border:'1px solid rgba(255,255,255,0.06)',background:'rgba(12,16,24,0.85)'}}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold text-white">Trade Terminal</h3>
        <span className="font-mono text-[9px] text-slate-500">sub-$1 contracts</span>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <button onClick={()=>setSide('YES')} className="rounded-lg py-2 text-center transition" style={{background:side==='YES'?'rgba(38,166,154,0.18)':'rgba(255,255,255,0.03)',border:`1px solid ${side==='YES'?'rgba(38,166,154,0.5)':'rgba(255,255,255,0.06)'}`}}>
          <div className="text-[9px] font-bold uppercase tracking-wider" style={{color:'#26a69a'}}>YES</div>
          <div className="mt-0.5 font-mono text-sm font-black" style={{color:'#26a69a'}}>{yP}¢</div>
        </button>
        <button onClick={()=>setSide('NO')} className="rounded-lg py-2 text-center transition" style={{background:side==='NO'?'rgba(239,83,80,0.18)':'rgba(255,255,255,0.03)',border:`1px solid ${side==='NO'?'rgba(239,83,80,0.5)':'rgba(255,255,255,0.06)'}`}}>
          <div className="text-[9px] font-bold uppercase tracking-wider" style={{color:'#ef5350'}}>NO</div>
          <div className="mt-0.5 font-mono text-sm font-black" style={{color:'#ef5350'}}>{nP}¢</div>
        </button>
      </div>
      <label className="mb-1 block text-[9px] font-medium uppercase tracking-wider text-slate-500">Amount (USD)</label>
      <div className="flex items-center rounded-lg px-2" style={{background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.08)'}}>
        <span className="font-mono text-xs text-slate-500">$</span>
        <input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value.replace(/[^0-9.]/g,''))} className="w-full bg-transparent px-1.5 py-2 font-mono text-sm font-bold text-white outline-none" placeholder="0" />
      </div>
      <div className="mt-2 flex gap-1.5">
        {QUICK.map(q=>(
          <button key={q} onClick={()=>setAmount(String(q))} className="flex-1 rounded-md py-1 font-mono text-[9px] font-bold text-slate-400 transition hover:text-white" style={{background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.06)'}}>${q}</button>
        ))}
      </div>
      <div className="mt-3 space-y-1.5 rounded-lg p-2.5" style={{background:'rgba(255,255,255,0.02)',border:'1px solid rgba(255,255,255,0.05)'}}>
        {[
          ['Implied probability',`${priceCents}%`,'#94a3b8'],
          ['Target shares',shares.toLocaleString(undefined,{maximumFractionDigits:1}),'#f5f7fa'],
          ['Est. fill price',`${fillPrice.toFixed(1)}¢`,'#94a3b8'],
          ['Slippage est.',`${slippage.toFixed(2)}%`,slippage>5?'#ef5350':'#94a3b8'],
          ['Max payout',fmtN(maxPayout),'#26a69a'],
        ].map(([l,v,c])=>(
          <div key={l} className="flex items-center justify-between text-[10px]"><span className="text-slate-500">{l}</span><span className="font-mono font-bold tabular-nums" style={{color:c as string}}>{v}</span></div>
        ))}
        <div className="mt-1 flex items-center justify-between border-t border-white/[0.06] pt-1.5 text-[10px]">
          <span className="text-slate-500">Max ROI</span>
          <span className="font-mono text-[13px] font-black tabular-nums" style={{color:clsC(roi)}}>{roi>0?'+':''}{roi.toFixed(1)}%</span>
        </div>
      </div>
      <button className="mt-3 w-full rounded-lg py-2.5 text-center text-[11px] font-bold text-white transition hover:opacity-90" style={{background:accent}}>
        Buy {side} · {fmtN(amt)}
      </button>
      <p className="mt-1.5 text-center text-[8px] leading-tight text-slate-600">Preview only — routing executes on the source venue.</p>
    </div>
  );
}

interface OBRow { price: number; size: number; }
function MicroOrderBook({yP,liquidity,seed}:{yP:number;liquidity:number;seed:string}) {
  const [book,setBook]=useState<{bids:OBRow[];asks:OBRow[]}>({bids:[],asks:[]});
  const [flash,setFlash]=useState<Set<number>>(new Set());
  const prevRef=useRef<Record<number,number>>({});

  useEffect(()=>{
    // Build & continuously perturb a deterministic ladder around the YES mid price.
    const baseUnit=(s:string)=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return((h>>>0)%1000)/1000;};
    const liq=Math.max(500,liquidity);
    const build=()=>{
      const asks:OBRow[]=[],bids:OBRow[]=[];
      for(let i=1;i<=6;i++){
        const ap=Math.min(99,yP+i);
        const bp=Math.max(1,yP-i);
        const aSize=Math.round(liq*(0.04+baseUnit(`${seed}-a-${i}`)*0.12)*(0.7+Math.random()*0.6));
        const bSize=Math.round(liq*(0.04+baseUnit(`${seed}-b-${i}`)*0.12)*(0.7+Math.random()*0.6));
        asks.push({price:ap,size:aSize});
        bids.push({price:bp,size:bSize});
      }
      const changed=new Set<number>();
      [...asks,...bids].forEach(r=>{const p=prevRef.current[r.price];if(p!==undefined&&p!==r.size)changed.add(r.price);prevRef.current[r.price]=r.size;});
      setBook({asks:asks.reverse(),bids});
      if(changed.size){setFlash(changed);setTimeout(()=>setFlash(new Set()),400);}
    };
    build();
    const t=setInterval(build,2500);
    return()=>clearInterval(t);
  },[yP,liquidity,seed]);

  const spread=book.asks.length&&book.bids.length?(book.asks[book.asks.length-1].price-book.bids[0].price):0;
  const maxSize=Math.max(1,...book.asks.map(r=>r.size),...book.bids.map(r=>r.size));

  const Row=({r,kind}:{r:OBRow;kind:'ask'|'bid'})=>{
    const color=kind==='ask'?'#ef5350':'#26a69a';
    const isNew=flash.has(r.price);
    return (
      <div className={`relative flex items-center justify-between px-2 py-[3px] font-mono text-[10px] ${isNew?(kind==='ask'?'row-flash-sell':'row-flash-buy'):''}`}>
        <span className="absolute inset-y-0 right-0" style={{width:`${(r.size/maxSize)*100}%`,background:kind==='ask'?'rgba(239,83,80,0.10)':'rgba(38,166,154,0.10)'}} />
        <span className="relative z-10 font-bold" style={{color}}>{r.price}¢</span>
        <span className="relative z-10 tabular-nums text-slate-400">{r.size.toLocaleString()}</span>
      </div>
    );
  };

  return (
    <div className="rounded-xl p-3" style={{border:'1px solid rgba(255,255,255,0.06)',background:'rgba(12,16,24,0.85)'}}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold text-white">Order Book</h3>
        <span className="font-mono text-[9px] text-slate-500">spread {spread}¢</span>
      </div>
      <div className="space-y-px">
        {book.asks.map(r=><Row key={'a'+r.price} r={r} kind="ask" />)}
        <div className="flex items-center justify-center gap-1 py-1 font-mono text-[11px] font-black" style={{color:'#26a69a'}}>
          {yP}¢ <span className="text-[8px] font-normal text-slate-600">mid</span>
        </div>
        {book.bids.map(r=><Row key={'b'+r.price} r={r} kind="bid" />)}
      </div>
    </div>
  );
}

export default function MarketPage({params}:{params:Promise<{id:string}>}) {
  const {id}=use(params);
  const [market,setMarket]=useState<MD|null>(null);
  const [trades,setTrades]=useState<Trade[]>([]);
  const [chart,setChart]=useState<CP[]>([]);
  const [loading,setLoading]=useState(true);
  const [filter,setFilter]=useState<'all'|'whales'>('all');
  const [auto,setAuto]=useState(true);
  const [flash,setFlash]=useState<Set<string>>(new Set());
  const prevIdRef=useRef<string>('');
  const prevCntRef=useRef(0);

  // CRITICAL: Reset state when id changes
  useEffect(()=>{
    if(prevIdRef.current!==id){
      setMarket(null);setTrades([]);setChart([]);setLoading(true);
      prevIdRef.current=id;
    }
  },[id]);

  const fetchM=useCallback(async()=>{
    try{
      const r=await fetch(`/api/markets/live?id=${id}`);
      const j=await r.json();const ms=j.markets||[];
      if(ms.length>0){setMarket(ms[0]);}
    }catch{/* */}
  },[id]);

  const fetchT=useCallback(async()=>{
    try{
      const r=await fetch(`/api/markets/trades?marketId=${encodeURIComponent(id)}`);const j=await r.json();const nt=j.trades||[];
      if(nt.length>prevCntRef.current&&prevCntRef.current>0){const s=new Set<string>();for(let i=0;i<Math.min(3,nt.length);i++)s.add(nt[i].id);setFlash(s);setTimeout(()=>setFlash(new Set()),400);}
      prevCntRef.current=nt.length;setTrades(nt);
    }catch{/* */}
  },[id]);

  // Fetch on mount AND when id changes
  useEffect(()=>{
    if(!id)return;
    fetchM();fetchT().then(()=>setLoading(false));
  },[id,fetchM,fetchT]);

  useEffect(()=>{
    if(auto){const i=setInterval(()=>{fetchM();fetchT();},5000);return()=>clearInterval(i);}
  },[auto,fetchM,fetchT]);

  // Build chart from trades
  useEffect(()=>{
    if(!market||trades.length<2)return;
    const now=Math.floor(Date.now()/1000);const pts:CP[]=[];
    for(let i=11;i>=0;i--){const s=now-i*3600;const st=trades.filter(t=>t.timestamp>=s&&t.timestamp<s+3600);const yp=st.filter(t=>t.outcome==='YES').map(t=>t.price);const avg=yp.length>0?yp.reduce((a,b)=>a+b,0)/yp.length:market.yes_price;pts.push({time:s,yes:Math.round(avg*100)/100,no:Math.round((1-avg)*100)/100});}
    setChart(pts);
  },[market,trades]);

  if(loading||!market)return <div className="flex min-h-screen items-center justify-center bg-[#06080f]"><div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" /></div>;

  const yP=market.yes_price,nP=market.no_price;
  const liq=market.liquidity||Math.round(market.volume_24h*0.35);
  const P=PL[market.platform]||{icon:'?',gradient:'from-slate-600 to-slate-700',name:market.platform};
  const ft=filter==='whales'?trades.filter(t=>t.total_value>=1000):trades;

  return (
    <div className="min-h-screen bg-[#06080f] text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-white/[0.04] bg-[#06080f]/90 backdrop-blur-xl px-4 py-2">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-sm font-bold text-slate-400 hover:text-white"><span className="text-blue-400">←</span> Terminal</Link>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[10px] text-slate-400"><input type="checkbox" checked={auto} onChange={e=>setAuto(e.target.checked)} className="h-3 w-3 accent-blue-500" />LIVE</label>
            <a href={market.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1 text-[10px] font-semibold text-white hover:bg-blue-700">
              <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full bg-white/20 text-[7px] font-black`}>{P.icon}</span>Trade on {P.name} ↗
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-4">
        {/* Identity Header */}
        <div className="mb-4 flex flex-wrap items-start gap-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="relative h-11 w-11 shrink-0">
              {!market.image_url?<div className={`flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br ${P.gradient} text-sm font-black text-white`} style={{border:'2px solid #0d1117'}}>{init2(market.question)}</div>
              :<img src={market.image_url} alt="" className="h-11 w-11 rounded-full object-cover" style={{border:'2px solid #0d1117'}} />}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-bold text-white leading-tight">{market.question}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className="rounded-md px-1.5 py-0.5 text-[9px] font-bold capitalize" style={{background:'rgba(255,255,255,0.06)',color:'#94a3b8'}}>{market.category}</span>
                <span className="rounded-md px-1.5 py-0.5 text-[9px] font-bold text-slate-400" style={{background:'rgba(255,255,255,0.06)'}}>Vol: {fmtN(market.volume_24h)}</span>
                <span className="rounded-md px-1.5 py-0.5 text-[9px] font-bold text-slate-400" style={{background:'rgba(255,255,255,0.06)'}}>Liq: {fmtN(liq)}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="rounded-xl p-3 text-center" style={{background:'rgba(38,166,154,0.08)',border:'1px solid rgba(38,166,154,0.15)',minWidth:100}}>
              <div className="text-[9px] font-bold uppercase tracking-wider" style={{color:'#26a69a'}}>YES</div>
              <div className="mt-1 font-mono text-xl font-black" style={{color:'#26a69a'}}>{yP}%</div>
            </div>
            <div className="rounded-xl p-3 text-center" style={{background:'rgba(239,83,80,0.08)',border:'1px solid rgba(239,83,80,0.15)',minWidth:100}}>
              <div className="text-[9px] font-bold uppercase tracking-wider" style={{color:'#ef5350'}}>NO</div>
              <div className="mt-1 font-mono text-xl font-black" style={{color:'#ef5350'}}>{nP}%</div>
            </div>
          </div>
        </div>

        {/* Main Grid */}
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          {/* Left: Chart + Ledger */}
          <div className="space-y-4">
            {/* Chart */}
            <div className="rounded-xl" style={{border:'1px solid rgba(255,255,255,0.06)',background:'rgba(12,16,24,0.8)'}}>
              <div className="flex items-center justify-between border-b border-white/[0.04] px-3 py-2">
                <h3 className="text-xs font-semibold text-white">📈 Probability Chart</h3>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1 text-[9px] font-bold" style={{color:'#26a69a'}}><span className="inline-block h-2 w-2 rounded-full" style={{background:'#26a69a'}} />YES {yP}%</span>
                  <span className="flex items-center gap-1 text-[9px] font-bold" style={{color:'#ef5350'}}><span className="inline-block h-2 w-2 rounded-full" style={{background:'#ef5350'}} />NO {nP}%</span>
                </div>
              </div>
              <div style={{height:320}}>
                {chart.length>1?<ProbChart data={chart} yP={yP} nP={nP} />:<div className="flex h-full items-center justify-center text-xs text-slate-500">Building chart from trade history...</div>}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <TopHoldersDonut trades={trades} />
              <LiquidityDistributionBar trades={trades} />
              <LiveLineProfile data={chart} />
            </div>

            {/* Ledger */}
            <div className="rounded-xl" style={{border:'1px solid rgba(255,255,255,0.06)',background:'rgba(12,16,24,0.8)'}}>
              <div className="flex items-center justify-between border-b border-white/[0.04] px-3 py-2">
                <h3 className="text-xs font-semibold text-white">⚡ Live Transactions ({ft.length})</h3>
                <div className="flex rounded-lg overflow-hidden" style={{border:'1px solid rgba(255,255,255,0.06)'}}>
                  <button onClick={()=>setFilter('all')} className={`px-2.5 py-1 text-[9px] font-medium transition ${filter==='all'?'bg-blue-600 text-white':'bg-white/[0.02] text-slate-400 hover:text-white'}`}>All</button>
                  <button onClick={()=>setFilter('whales')} className={`px-2.5 py-1 text-[9px] font-medium transition ${filter==='whales'?'bg-amber-600 text-white':'bg-white/[0.02] text-slate-400 hover:text-white'}`}>🐋 Whales</button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                  <thead><tr className="border-b border-white/[0.04] bg-white/[0.01] text-[10px] text-slate-500">
                    <th className="px-2 py-2 font-medium text-left" style={{width:85}}>Time</th>
                    <th className="px-2 py-2 font-medium text-left" style={{width:75}}>Type</th>
                    <th className="px-2 py-2 font-medium text-left" style={{width:80}}>Outcome</th>
                    <th className="px-2 py-2 font-medium text-right" style={{width:105}}>Price</th>
                    <th className="px-2 py-2 font-medium text-right" style={{width:120}}>Total USD</th>
                    <th className="px-2 py-2 font-medium text-right" style={{width:110}}>Qty</th>
                    <th className="px-2 py-2 font-medium text-left" style={{width:130}}>Account</th>
                  </tr></thead>
                  <tbody>
                    {ft.slice(0,50).map((t,i)=>{
                      const isNew=flash.has(t.id);
                      const ts=new Date(t.timestamp*1000).toLocaleTimeString('en-US',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
                      return (
                        <tr key={t.id+'-'+i} className={`border-b border-white/[0.02] transition-all duration-300 hover:bg-white/[0.03] group ${isNew ? (t.side==='BUY'?'row-flash-buy':'row-flash-sell') : ''}`}>
                          <td className="px-2 py-2 font-mono text-slate-400">{ts}</td>
                          <td className="px-2 py-2"><span className="inline-block rounded-md px-1.5 py-0.5 text-[8px] font-bold" style={{background:t.side==='BUY'?'rgba(38,166,154,0.2)':'rgba(239,83,80,0.2)',color:t.side==='BUY'?'#26a69a':'#ef5350'}}>{t.side}</span></td>
                          <td className="px-2 py-2"><span className={`font-bold text-[10px] ${t.outcome==='YES'?'text-emerald-400':'text-red-400'}`}>{t.outcome}</span></td>
                          <td className="px-2 py-2 text-right font-mono text-slate-300">{(t.price*100).toFixed(1)}¢</td>
                          <td className="px-2 py-2 text-right font-mono font-bold text-white">{fmtN(t.total_value)}</td>
                          <td className="px-2 py-2 text-right font-mono text-slate-300">{t.size.toLocaleString()}</td>
                          <td className="px-2 py-2 font-mono text-slate-500 group-hover:text-blue-400 transition-colors cursor-pointer" title={t.wallet} onClick={()=>navigator.clipboard?.writeText(t.wallet)}>
                            {t.wallet?.substring(0,6)}...{t.wallet?.substring(t.wallet.length-4)}<span className="ml-1 opacity-0 group-hover:opacity-100 text-[8px]">📋</span>
                          </td>
                        </tr>
                      );
                    })}
                    {ft.length===0&&<tr><td colSpan={7} className="py-8 text-center text-xs text-slate-500">Waiting for live transactions...</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <div className="lg:sticky lg:top-16 space-y-4">
              <TradingTerminal yP={yP} nP={nP} liquidity={liq} />
              <MicroOrderBook yP={yP} liquidity={liq} seed={market.id} />
            </div>
            <div className="rounded-xl p-3" style={{border:'1px solid rgba(255,255,255,0.06)',background:'rgba(12,16,24,0.8)'}}>
              <h3 className="mb-3 text-[11px] font-semibold text-white">📊 Analytics</h3>
              <div className="grid grid-cols-2 gap-2">
                {[['Liquidity',fmtN(liq)],['24h Vol',fmtN(market.volume_24h)],['MCAP',fmtN(market.mcap)],['Txns',market.txns.toLocaleString()],['Traders',market.traders.toLocaleString()],['Open Int',fmtN(Math.round(liq*0.8))]].map(([l,v])=>(
                  <div key={l} className="rounded-lg p-2" style={{background:'rgba(255,255,255,0.02)',border:'1px solid rgba(255,255,255,0.04)'}}>
                    <div className="text-[8px] font-medium uppercase tracking-wider text-slate-500">{l}</div>
                    <div className="mt-0.5 font-mono text-[12px] font-bold text-white">{v}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-lg p-2.5" style={{background:'rgba(255,255,255,0.02)',border:'1px solid rgba(255,255,255,0.04)'}}>
                <div className="mb-1.5 text-[9px] font-medium uppercase tracking-wider text-slate-500">Probability Change</div>
                <div className="grid grid-cols-4 gap-2">
                  {[['5M',market.price_change_5m],['1H',market.price_change_1h],['6H',market.price_change_6h],['24H',market.price_change_24h]].map(([l,v])=>(
                    <div key={l} className="text-center"><div className="text-[8px] text-slate-500">{l}</div><div className="font-mono text-[11px] font-bold" style={{color:clsC(Number(v))}}>{Number(v)>0?'+':''}{Number(v).toFixed(1)}%</div></div>
                  ))}
                </div>
              </div>
            </div>
            <div className="rounded-xl p-3" style={{border:'1px solid rgba(255,255,255,0.06)',background:'rgba(12,16,24,0.8)'}}>
              <h3 className="mb-3 text-[11px] font-semibold text-white">ℹ️ Info</h3>
              <div className="space-y-2 text-[10px]">
                <div className="flex items-center justify-between"><span className="text-slate-500">Platform</span><span className="flex items-center gap-1.5"><span className={`inline-flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-br ${P.gradient} text-[7px] font-black text-white`}>{P.icon}</span><span className="capitalize text-white font-medium">{P.name}</span></span></div>
                <div className="flex items-center justify-between"><span className="text-slate-500">Category</span><span className="capitalize text-white">{market.category}</span></div>
                <div className="flex items-center justify-between"><span className="text-slate-500">Age</span><span className="text-white">{market.age_hours<1?`${Math.round(market.age_hours*60)}m`:market.age_hours<24?`${Math.round(market.age_hours)}h`:`${Math.round(market.age_hours/24)}d`}</span></div>
              </div>
              <div className="mt-3"><a href={market.url} target="_blank" rel="noreferrer" className="flex w-full items-center justify-center gap-2 rounded-lg bg-white/[0.04] py-2 text-[10px] font-medium text-blue-400 hover:bg-blue-600 hover:text-white transition">View on {P.name} ↗</a></div>
            </div>
          </div>
        </div>
      </main>
      <style jsx global>{`@keyframes rowFlashBuy{0%{background:rgba(38,166,154,0.24);}100%{background:transparent;}}@keyframes rowFlashSell{0%{background:rgba(239,83,80,0.24);}100%{background:transparent;}}.row-flash-buy{animation:rowFlashBuy 400ms ease-out;}.row-flash-sell{animation:rowFlashSell 400ms ease-out;}`}</style>
    </div>
  );
}
