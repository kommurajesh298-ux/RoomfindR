const e="₹",n=t=>{const r=typeof t=="string"?Number(t):t??0;return Number.isFinite(r)?r:0},o=t=>n(t).toLocaleString("en-IN"),c=t=>`₹${o(t)}`;export{e as R,c as f};
