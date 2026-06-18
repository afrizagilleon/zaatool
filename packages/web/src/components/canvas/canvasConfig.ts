import { CodeNode } from '../nodes/CodeNode';
import { IfNode } from '../nodes/IfNode';
import { LoopNode } from '../nodes/LoopNode';
import { UiInputNode } from '../nodes/UiInputNode';
import { UiTableNode } from '../nodes/UiTableNode';
import { UiChartNode } from '../nodes/UiChartNode';
import { UiTextNode } from '../nodes/UiTextNode';
import { UiImageNode } from '../nodes/UiImageNode';
import { FileNode } from '../nodes/FileNode';
import { TriggerStartNode } from '../nodes/TriggerStartNode';
import { TriggerCronNode } from '../nodes/TriggerCronNode';
import type { FlowNodeData } from '../../store/flowStore';

export const nodeTypes = {
  code: CodeNode,
  if: IfNode,
  loop: LoopNode,
  'ui:input': UiInputNode,
  'ui:table': UiTableNode,
  'ui:chart': UiChartNode,
  'ui:text': UiTextNode,
  'ui:image': UiImageNode,
  file: FileNode,
  'trigger:start': TriggerStartNode,
  'trigger:cron': TriggerCronNode,
};

export const defaultNodeData: Record<string, () => FlowNodeData> = {
  'code:node': () => ({
    label: 'Code (JS)',
    runtime: 'node',
    code: '// Write your JavaScript here\nreturn { output1: input1 };',
    inputsSchema: [{ name: 'input1', type: 'string' }],
    outputsSchema: [{ name: 'output1', type: 'string' }],
  }),
  'code:python': () => ({
    label: 'Code (Python)',
    runtime: 'python',
    code: '# Write your Python here\nreturn {"output1": input1}',
    inputsSchema: [{ name: 'input1', type: 'string' }],
    outputsSchema: [{ name: 'output1', type: 'string' }],
  }),
  'if:': () => ({
    label: 'If / Branch',
    code: '// Return true or false\nreturn input1 === true;',
    inputsSchema: [{ name: 'condition', type: 'boolean' }],
    outputsSchema: [
      { name: 'true', type: 'boolean' },
      { name: 'false', type: 'boolean' },
    ],
  }),
  'loop:': () => ({
    label: 'Loop',
    inputsSchema: [{ name: 'list', type: 'array' }],
    outputsSchema: [
      { name: 'element', type: 'object' },
      { name: 'body', type: 'object' },
      { name: 'completed', type: 'object' },
    ],
  }),
  'ui:input:': () => ({
    label: 'Input Form',
    uiSchema: { fields: [], layout: { columns: 1, triggerOn: 'submit' } },
    inputsSchema: [],
    outputsSchema: [{ name: 'values', type: 'object' }],
  }),
  'ui:table:': () => ({
    label: 'Data Table',
    tableConfig: { columns: [] },
    inputsSchema: [{ name: 'data', type: 'table' }],
    outputsSchema: [{ name: 'selectedRow', type: 'object' }],
  }),
  'ui:chart:': () => ({
    label: 'Chart Display',
    chartConfig: { type: 'bar', xAxisKey: '', yAxisKeys: [], colors: ['#3b82f6'], jsonConfig: '' },
    inputsSchema: [{ name: 'data', type: 'table' }],
    outputsSchema: [],
  }),
  'ui:text:': () => ({
    label: 'Text Display',
    inputsSchema: [
      { name: 'value', type: 'string' },
      { name: 'format', type: 'string' },
    ],
    outputsSchema: [],
  }),
  'ui:image:': () => ({
    label: 'Image',
    inputsSchema: [{ name: 'src', type: 'image' }],
    outputsSchema: [],
  }),
  'file:': () => ({
    label: 'File Input',
    inputsSchema: [],
    outputsSchema: [{ name: 'file', type: 'string' }],
  }),
  'trigger:start:': () => ({
    label: 'Start Trigger',
    inputsSchema: [],
    outputsSchema: [{ name: 'trigger', type: 'any' }],
  }),
  'trigger:cron:': () => ({
    label: 'Cron Trigger',
    inputsSchema: [],
    outputsSchema: [{ name: 'trigger', type: 'any' }],
    cronExpression: '*/5 * * * *',
    enabled: true,
  }),
};
