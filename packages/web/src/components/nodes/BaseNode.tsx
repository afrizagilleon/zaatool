import { Handle, Position } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';
import type { NodeDef } from '@zaa-tool/shared';
import { Code, Question, ArrowsClockwise } from '@phosphor-icons/react';

const icons = {
 code: <Code size={16} />,
 if: <Question size={16} />,
 loop: <ArrowsClockwise size={16} />
};

export const BaseNode = ({ data, type, selected }: NodeProps<Node<NodeDef['data'], string>>) => {
 const inputs = data.inputsSchema || [];
 const outputs = data.outputsSchema || [];

 return (
 <div className={` border bg-card text-card-foreground shadow-sm w-64 ${selected ? 'border-primary ring-1 ring-primary' : 'border-border'}`}>
 <div className="flex items-center gap-2 border-b border-border bg-muted/50 p-3">
 {icons[type as keyof typeof icons] || <Code size={16} />}
 <span className="text-sm font-medium">{data.label || type}</span>
 </div>
 
 <div className="flex flex-col gap-2 p-3">
 <div className="flex justify-between">
 <div className="flex flex-col gap-2">
 {inputs.map((input) => (
 <div key={`in-${input.name}`} className="relative flex items-center h-5">
 <Handle
 type="target"
 position={Position.Left}
 id={input.name}
 className="w-3 h-3 border-2 border-background bg-primary -left-4"
 />
 <span className="text-xs text-muted-foreground ml-1">{input.name}: {input.type}</span>
 </div>
 ))}
 </div>
 
 <div className="flex flex-col gap-2 items-end">
 {outputs.map((output) => (
 <div key={`out-${output.name}`} className="relative flex items-center justify-end h-5">
 <span className="text-xs text-muted-foreground mr-1">{output.name}: {output.type}</span>
 <Handle
 type="source"
 position={Position.Right}
 id={output.name}
 className="w-3 h-3 border-2 border-background bg-primary -right-4"
 />
 </div>
 ))}
 </div>
 </div>
 </div>
 </div>
 );
};

export const CodeNode = (props: any) => <BaseNode {...props} type="code" />;
export const IfNode = (props: any) => <BaseNode {...props} type="if" />;
export const LoopNode = (props: any) => <BaseNode {...props} type="loop" />;
