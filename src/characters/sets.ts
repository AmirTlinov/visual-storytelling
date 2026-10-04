import type { StageSet } from './types.js';
import { bulb, workbench, seedling } from './props.js';

/** The accepted Tesla composition; all contacts use the same 680 × 650 frame. */
export function laboratory(): StageSet {
  return {
    width: 680,
    height: 650,
    spots: { center: { x: 320, y: 597 }, lamp: { x: 586, y: 484 } },
    svg: `<defs><radialGradient id="$id-wall"><stop stop-color="#426069"/><stop offset="1" stop-color="#233a44"/></radialGradient></defs>
<path fill="url(#$id-wall)" d="M0 0h680v650H0z"/>
<path fill="#283b40" d="M0 460h680v140H0z"/><path d="M0 460h680" stroke="#64726a" stroke-width="7"/>
<path fill="#726a55" d="M0 596h680v54H0z"/><path d="M0 597h680M80 597L42 650M243 597l-13 53M425 597l12 53M590 597l45 53" stroke="#514f44" stroke-width="2"/>
<g stroke="#172d37" stroke-width="6"><path fill="#3a6174" d="M34 318V131q0-92 89-92t89 92v187z"/><path d="M123 40v278M34 176h178" fill="none"/><path fill="#ab986f" d="M27 317h193v15H27z"/></g>
<circle cx="168" cy="104" r="20" fill="#dacda6"/><path fill="#244453" d="M38 275l20-22 15 12v-34h22v51l24-20 27 21v-58h20v29l18-11 24 23v49H38z"/>
<path fill="#ad9771" stroke="#1f343b" stroke-width="3" d="M477 85l151 5-8 173-152-6z"/><g fill="none" stroke="#58635c" stroke-width="3"><path d="M489 199h28v-42h24v42h64M529 138v84"/><circle cx="576" cy="181" r="22"/><path d="M490 240h110"/></g>
<path d="M0 26q300-34 600 7v20" fill="none" stroke="#152d37" stroke-width="4"/><path d="M575 68l12-18h27l17 18z" fill="#cba766" stroke="#172e37" stroke-width="4"/>
`,
    props: {
      table: { art: workbench, at: { x: 586, y: 591 }, layer: 'back' },
      lamp: { art: bulb, at: 'lamp', layer: 'back', values: { light: 0 } },
    },
  };
}

export function conservatory(): StageSet {
  return {
    width: 680,
    height: 650,
    spots: { center: { x: 286, y: 597 }, plant: { x: 559, y: 475 } },
    svg: `<defs><linearGradient id="$id-sky" x2="0" y2="1"><stop stop-color="#aec5bc"/><stop offset="1" stop-color="#d5d9b3"/></linearGradient></defs>
    <path fill="#3e645e" d="M0 0h680v650H0z"/><path d="M20 40Q340-32 660 40v416H20Z" fill="url(#$id-sky)" stroke="#294b48" stroke-width="7"/>
    <circle cx="527" cy="115" r="43" fill="#eee0a6"/><g fill="#8ca78e"><path d="M20 390q80-156 164-26 93-216 180-61 116-194 192 19 64-72 104-10v160H20Z"/></g>
    <g stroke="#40655d" stroke-width="8" fill="none"><path d="M172 13v443M340 2v454M508 13v443M20 229h640M20 451h640"/></g>
    <path fill="#526f5b" d="M0 462h680v138H0z"/><path stroke="#9ba385" stroke-width="7" d="M0 462h680"/>
    <path fill="#aa9b74" d="M0 597h680v53H0z"/><path stroke="#7c795c" stroke-width="2" d="M0 598h680M89 598l-25 52m170-52-6 52m219-52 9 52m145-52 26 52"/>
    <g fill="#789569" stroke="#315548" stroke-width="3"><path d="M58 570Q0 513 22 465q59 22 36 105Z"/><path d="M59 564q1-92 55-99 9 72-55 99Z"/><path d="M50 570H94L83 613H60Z" fill="#866e50"/></g>
    <path d="M0 40q290-48 680 0" fill="none" stroke="#31544e" stroke-width="6"/>`,
    props: {
      table: { art: workbench, at: { x: 559, y: 582 }, layer: 'back' },
      plant: { art: seedling, at: 'plant', layer: 'back', values: { growth: 0 } },
    },
  };
}

export function workshop(): StageSet {
  return {
    width: 960,
    height: 650,
    spots: { left: { x: 263, y: 592 }, right: { x: 711, y: 592 }, center: { x: 480, y: 592 } },
    svg: `<defs><radialGradient id="$id-wall"><stop stop-color="#617773"/><stop offset="1" stop-color="#2c494d"/></radialGradient></defs>
    <path fill="url(#$id-wall)" d="M0 0h960v650H0z"/><path fill="#2e4749" d="M0 463h960v140H0z"/><path stroke="#829284" stroke-width="7" d="M0 463h960"/>
    <path fill="#8e8265" d="M0 597h960v53H0z"/><path d="M0 597h960M130 597l-28 53m260-53-10 53m246-53 10 53m240-53 28 53" stroke="#625f4f" stroke-width="2"/>
    <g fill="#b2a27c" stroke="#253f43" stroke-width="4"><path d="M44 83h174v145H44zM742 83h174v145H742z"/></g>
    <g stroke="#60746a" stroke-width="3" fill="none"><circle cx="131" cy="154" r="39"/><path d="M92 154h78M131 115v78M111 134l40 40m-40 0 40-40M773 183l38-51 35 33 35-52M774 206h109"/></g>
    <path d="M0 33q480-42 960 0M480 12v49" fill="none" stroke="#233e44" stroke-width="5"/><path fill="#d4b476" stroke="#233e44" stroke-width="4" d="M441 85l21-28h36l21 28z"/>
    <path fill="#d8bc78" opacity=".075" d="M441 89 263 594h435L519 89Z"/>`,
    props: {},
  };
}
