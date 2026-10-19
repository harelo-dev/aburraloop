export const cop = (v: number) =>
  v >= 1e6 ? `$${(v / 1e6).toFixed(2).replace('.', ',')} M` : `$${Math.round(v / 1e3)} k`
export const dec = (v: number) => v.toFixed(1).replace('.', ',')
export const copSigned = (v: number) => (Math.abs(v) < 500 ? cop(0) : `${v < 0 ? '−' : ''}${cop(Math.abs(v))}`)
