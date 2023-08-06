import { AnyBoundController, UnboundEvents } from './binder';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      a: AnchorProperties;
      aside: Properties;
      button: Properties;
      canvas: Properties;
      circle: CircleProperties;
      div: Properties;
      footer: Properties;
      g: GroupProperties;
      header: Properties;
      i: Properties;
      img: ImageProperties;
      input: InputProperties;
      label: Properties;
      li: Properties;
      line: LineProperties;
      main: Properties;
      option: OptionProperties;
      p: Properties;
      polyline: PolylineProperties;
      section: Properties;
      select: Properties;
      span: Properties;
      svg: SVGProperties;
      table: Properties;
      tbody: Properties;
      td: Properties;
      text: TextProperties;
      th: Properties;
      thead: Properties;
      tr: Properties;
      ul: Properties;
    }
  }
}

export interface Properties {
  children?: unknown[],
  className?: string;
  js?: AnyBoundController;
  style?: string; // TODO(april): this is sad
  tabIndex?: string;
  title?: string;
  unboundEvents?: UnboundEvents;
}

export interface AnchorProperties extends Properties {
  href?: string;
  target?: '_self'|'_blank'|'_parent'|'_top';
}

export interface GroupProperties extends Properties {}

export interface ImageProperties extends Properties {
  alt?: string;
  height?: string;
  src?: string;
  width?: string;
}

export interface InputProperties extends Properties {
  checked?: boolean;
  name?: string;
  placeholder?: string;
  type?: 'checkbox'|'password'|'radio'|'text';
  value?: string;
}

export interface OptionProperties extends Properties {
  value?: string;
}

export interface SVGGraphicsProperties extends Properties {
  vector_effect?: 'none'|'non-scaling-stroke'|'non-scaling-size'|'non-rotation'|'fixed-position';
}

export interface CircleProperties extends SVGGraphicsProperties, Properties {
  fill?: string;
  stroke?: string;
  stroke_width?: number|string;
  cx: number|string;
  cy: number|string;
  r: number|string;
}

export interface LineProperties extends SVGGraphicsProperties, Properties {
  stroke?: string;
  stroke_linejoin?: 'arcs'|'bevel'|'miter'|'miter-clip'|'round';
  stroke_width?: number|string;
  x1: number|string;
  y1: number|string;
  x2: number|string;
  y2: number|string;
}

export interface PolylineProperties extends SVGGraphicsProperties, Properties {
  fill?: string;
  stroke?: string;
  stroke_linejoin?: 'arcs'|'bevel'|'miter'|'miter-clip'|'round';
  stroke_width?: number|string;
  points: string;
}

export interface SVGProperties extends Properties {
  height?: number|string;
  viewBox?: string;
  width?: number|string;
}

export interface TextProperties extends SVGGraphicsProperties, Properties {
  dominant_baseline?:
      'auto'|'text-bottom'|'alphabetic'|'ideographic'|'middle'|'central'|'mathematical'|'hanging'
            |'text-top';
  text_anchor?: 'start'|'middle'|'end';
  x?: number|string;
  y?: number|string;
  dx?: number|string;
  dy?: number|string;
}

export type AnyProperties = InputProperties & Properties;
