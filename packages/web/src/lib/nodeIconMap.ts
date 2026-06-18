import {
  Code,
  BracketsCurly,
  GitBranch,
  ArrowsClockwise,
  AppWindow,
  Table as TableIcon,
  TextAa,
  Image as ImageIcon,
  File as FileIcon,
} from '@phosphor-icons/react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';

interface NodeIconAndClass {
  Icon: PhosphorIcon;
  accent: string;
}

export function getNodeIconAndClass(nodeType: string, runtime: string): NodeIconAndClass {
  switch (nodeType) {
    case 'if':         return { Icon: GitBranch,      accent: 'text-node-if' };
    case 'loop':       return { Icon: ArrowsClockwise, accent: 'text-node-loop' };
    case 'ui:input':   return { Icon: AppWindow,       accent: 'text-primary' };
    case 'ui:table':   return { Icon: TableIcon,       accent: 'text-blue-500' };
    case 'ui:text':    return { Icon: TextAa,          accent: 'text-green-500' };
    case 'ui:image':   return { Icon: ImageIcon,       accent: 'text-purple-500' };
    case 'file':       return { Icon: FileIcon,        accent: 'text-orange-500' };
    default:           return {
      Icon:   runtime === 'python' ? BracketsCurly : Code,
      accent: runtime === 'python' ? 'text-node-code-py' : 'text-node-code',
    };
  }
}
