import * as Primitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import type { ComponentProps } from 'react';
export function Checkbox(props: ComponentProps<typeof Primitive.Root>) {
  return <Primitive.Root {...props}><Primitive.Indicator style={{ display: 'grid', placeItems: 'center' }}><Check size={16} /></Primitive.Indicator></Primitive.Root>;
}
