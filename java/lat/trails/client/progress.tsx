import * as corgi from 'js/corgi';

export function IndeterminantCircular() {
  return <>
    <div className="indeterminant-circular h-8 relative text-3xl w-8"></div>
  </>;
}

export function IndeterminantLinear() {
  return <>
    <div
        className="indeterminant-linear absolute h-1 left-0 right-0 select-none top-0 touch-none"
    >
    </div>
  </>;
}

