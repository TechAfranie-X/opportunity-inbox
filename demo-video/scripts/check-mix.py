"""Numeric intelligibility check: voice vs music per narration line, full band and in the speech band (300-4000 Hz)."""
import numpy as np, scipy.io.wavfile as w, json, os
from scipy import signal
R=os.path.abspath(os.path.join(os.path.dirname(__file__),"..")); SR=48000
tl=json.load(open(f"{R}/timeline.json"))
rd=lambda p:(lambda x:(x.mean(1) if x.ndim>1 else x).astype(float)/32768)(w.read(p)[1])
v,m=rd(f"{R}/.sfx/stems/voice.wav"),rd(f"{R}/.sfx/stems/music.wav")
sos=signal.butter(4,[300,4000],"bp",fs=SR,output="sos"); vb,mb=signal.sosfilt(sos,v),signal.sosfilt(sos,m)
db=lambda x:20*np.log10(np.sqrt(np.mean(x**2))+1e-9)
seg=lambda x,a,b:x[int(a*SR):int(b*SR)]
print("line  voice-music (full)  voice-music (300-4k Hz)")
worst=99
for k,l in tl["lines"].items():
    a,b=l["start"],l["end"]; act=lambda x:x[np.abs(seg(v,a,b))>0.003] if False else seg(x,a,b)
    vv=seg(v,a,b); mask=np.abs(vv)>0.003
    full=db(vv[mask])-db(seg(m,a,b)); band=db(seg(vb,a,b)[mask])-db(seg(mb,a,b))
    worst=min(worst,band); print(f"{k:4s}  {full:5.1f} dB            {band:5.1f} dB")
print(f"worst speech-band margin: {worst:.1f} dB")
def lvl(x,a,b): return db(seg(x,a,b))
print("music RMS dBFS: intro 1-3s %.1f | pre-drop 6-8s %.1f | body 14-17s %.1f | final 29.2-30.2s %.1f"%(lvl(m,1,3),lvl(m,6,8),lvl(m,14,17),lvl(m,29.2,30.2)))
print("music in the last pause before the tagline %.1f vs inside tagline %.1f"%(lvl(m,tl['lines']['l7']['end'],tl['lines']['l8']['start']),lvl(m,tl['lines']['l8']['start'],tl['lines']['l8']['end'])))
