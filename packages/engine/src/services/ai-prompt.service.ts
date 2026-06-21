import type { GenerateOptions } from "./ai.service.js";

export class AiPromptService {
  build(options: GenerateOptions): string {
    let prompt = `You are an expert AI coding assistant for a visual node-based engine.\n`;
    if (options.systemPrompt) prompt += `System Prompt: ${options.systemPrompt}\n`;

    if (options.skills && options.skills.length > 0) {
      prompt += `\nRelevant Skills/Context:\n${options.skills.join("\n\n")}\n`;
    }

    if (options.existingCode && options.existingCode.trim()) {
      const codeBlockLang = options.runtime === "python" ? "python" : options.runtime === "json" ? "json" : "javascript";
      prompt += `\nExisting Code:\n\`\`\`${codeBlockLang}\n${options.existingCode}\n\`\`\`\n`;
      if (options.runtime === "json") {
        prompt += `This is the CURRENT form schema. Preserve ALL existing fields exactly as-is. Only ADD new fields or MODIFY a specific field if the instruction explicitly asks for it. Do NOT remove any existing fields unless the user explicitly says to remove them.\n`;
      } else {
        prompt += `Please base your code on the existing code above, fixing errors, enhancing it, or refactoring it as requested in the instruction.\n`;
      }
    }

    prompt += `\nTask: ${options.instruction}\n`;
    prompt += `Runtime: ${options.runtime} (${options.runtime === "python" ? "Python 3" : options.runtime === "json" ? "JSON Schema" : "Node.js JS/TS"})\n`;

    if (options.upstreamNodes && options.upstreamNodes.length > 0) {
      prompt += `\nUpstream Node Schemas & Connections (Data is available in the 'inputs' object):\n`;
      options.upstreamNodes.forEach((n: Record<string, unknown>) => {
        if (n.targetHandle && n.sourceHandle) {
          prompt += `- Input handle '${n.targetHandle}' is connected to Node '${n.label}' output '${n.sourceHandle}'.\n`;
          const outputsSchema = Array.isArray(n.outputsSchema) ? n.outputsSchema : [];
          const specificOutput = outputsSchema.find((o: Record<string, unknown>) => o.name === n.sourceHandle);
          prompt += `  Schema for '${n.targetHandle}': ${JSON.stringify(specificOutput || outputsSchema)}\n`;
        } else {
          prompt += `- Upstream Node '${n.label}': ${JSON.stringify(n.outputsSchema)}\n`;
        }
      });
    }

    prompt += `\nThis Node Schema:\n`;
    prompt += `- Inputs: ${JSON.stringify(options.thisNode.inputsSchema)}\n`;
    prompt += `- Outputs: ${JSON.stringify(options.thisNode.outputsSchema)}\n`;

    prompt += `\nRun Condition (runCondition):\n`;
    prompt += `Each node has an optional runCondition — a JS expression evaluated before execution.\n`;
    prompt += `If false, the node is skipped and outputs null. Has access to 'inputs' (wired edges) and 'inputs.form' (form context).\n`;
    prompt += `Examples:\n`;
    prompt += `  inputs.form.freq === 'per week'\n`;
    prompt += `  inputs.form.freq === 'per week' && inputs.form.start_date !== null\n`;
    prompt += `  inputs.is_selected === true\n`;

    if (options.formNodes && options.formNodes.length > 0) {
      prompt += `\nForm Context (inputs.form):\n`;
      prompt += `All Input Form nodes in the flow are automatically available via 'inputs.form' without needing an edge connection.\n`;
      if (options.formNodes.length === 1) {
        const form = options.formNodes[0];
        prompt += `Form: "${form.label}" — fields: ${form.fields.map((f) => `${f.id} (${f.type})`).join(", ")}\n`;
        prompt += `Access: const { ${form.fields.map((f) => f.id).join(", ")} } = inputs.form;\n`;
      } else {
        prompt += `Multiple forms present — use flat access for convenience or namespaced access to avoid conflicts:\n`;
        options.formNodes.forEach((form) => {
          prompt += `- "${form.label}": fields [${form.fields.map((f) => `${f.id}`).join(", ")}]\n`;
          prompt += `  Namespaced: inputs.form.__nodes["${form.label}"].fieldId\n`;
        });
        prompt += `Flat access (last-write-wins if field IDs conflict): inputs.form.fieldId\n`;
      }
    }

    prompt += `\nData Type Guidelines:\n`;
    prompt += `- 'table': Tabular data. Must be returned as a flat array of objects (e.g. [{"id": 1, "name": "John"}, {"id": 2, "name": "Jane"}]). Do not return a stringified JSON array, return a real array of objects.\n`;
    prompt += `- 'image': A string representing an image URL or local storage path (e.g. 'uploads/image.png').\n`;
    prompt += `- 'file': An object containing file metadata, e.g. { name: string, path: string, url: string }.\n`;
    prompt += `- 'object': A dictionary/object with keys and values. For Form Inputs (ui:input), fields are grouped inside this object.\n`;

    if (options.runtime === "json") {
      prompt += `\nWrite ONLY raw, valid JSON inside a markdown code block (\`\`\`json ... \`\`\`). Do not explain. Do not wrap with extra text.\n`;
      prompt += `Important: The JSON must represent the schema for the form. It must have a 'fields' array, where each field has: 'id', 'type' (text, textarea, number, select, radio), 'label', and optional 'required' (boolean), 'placeholder', 'options' (array of {label, value} objects for select/radio).\n`;
      if (options.existingCode && options.existingCode.trim()) {
        prompt += `CRITICAL: You MUST output the complete merged schema — include ALL existing fields from the Existing Code plus any new/modified fields. Never output a partial schema or drop existing fields.\n`;
      }
      prompt += `Example output form schema:\n`;
      prompt += `\`\`\`json\n{\n  "fields": [\n    {"id": "name", "type": "text", "label": "Full Name", "required": true},\n    {"id": "gender", "type": "select", "label": "Gender", "options": [{"label": "Male", "value": "male"}, {"label": "Female", "value": "female"}]}\n  ],\n  "layout": {"columns": 1, "triggerOn": "submit"}\n}\n\`\`\``;
    } else if (options.runtime === "python") {
      prompt += `\nWrite ONLY the raw Python code inside a markdown code block (\`\`\`python ... \`\`\`). Do not explain.\n`;
      prompt += `Provide a function \`def main(inputs):\` that returns a dictionary matching the output schema format (e.g. \`return { "output_name": value }\`).\n`;
      prompt += `Access inputs using the 'inputs' dictionary parameter (e.g., \`inputs['input_name']\`).\n`;
      prompt += `Note that certain inputs may be wrapped in helper classes:\n`;
      prompt += `- Table inputs: Use methods like \`.get_rows()\`, \`.get_column("col")\`, \`.get_row(0)\`, \`.get_headers()\`, \`.get_cell(0, "col")\`, \`.count()\`, \`.filter(fn)\`.\n`;
      prompt += `- File inputs: Use methods like \`.read_as_text()\`, \`.read_as_base64()\`, \`.exists()\`.\n`;
      prompt += `- Image inputs: Use methods like \`.to_data_uri(mime_type)\`, \`.read_as_base64()\`, \`.exists()\`.\n`;
    } else {
      prompt += `\nWrite ONLY the raw JavaScript code inside a markdown code block (\`\`\`javascript ... \`\`\`). Do not explain.\n`;
      prompt += `The code is wrapped inside an async function. Return the outputs as a JavaScript object (e.g., \`return { output_name: value };\`).\n`;
      prompt += `Access inputs using the 'inputs' parameter (e.g., \`inputs.input_name\`).\n`;
      prompt += `Note that certain inputs may be wrapped in helper classes:\n`;
      prompt += `- Table inputs: Use methods like \`.getRows()\`, \`.getColumn("col")\`, \`.getRow(0)\`, \`.getHeaders()\`, \`.getCell(0, "col")\`, \`.count()\`, \`.filter(fn)\`.\n`;
      prompt += `- File inputs: Use methods like \`.readAsText()\`, \`.readAsBase64()\`, \`.readAsBuffer()\`, \`.exists()\`.\n`;
      prompt += `- Image inputs: Use methods like \`.toDataUri(mimeType)\`, \`.readAsBase64()\`, \`.exists()\`.\n`;
    }

    return prompt;
  }
}

export const aiPromptService = new AiPromptService();
