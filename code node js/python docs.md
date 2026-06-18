# Developer Documentation: JavaScript & Python Code Nodes

This guide details how to work with JavaScript (Node.js) and Python Code Nodes in ZaaTool, including how to read inputs, access environment secrets, call helper methods on structured data wrappers, and format your outputs.

---

## 1. JavaScript (Node.js) Execution Environment

JavaScript Code Nodes execute in a secure Worker Thread using Node.js. The code is implicitly wrapped in an asynchronous function.

### Accessing Inputs
All inputs defined in the node's **Input Schema** are passed as properties of the global `inputs` object:
```javascript
const tableData = inputs.my_table;
const fileMeta = inputs.my_file;
const textInput = inputs.text_field;
```

### Exposed Classes & Wrapper Helpers
Inputs of type `table`, `file`, and `image` are automatically wrapped in helper classes to simplify data extraction:

#### A. `Table` Class
* **`.getRows()`**: Returns the raw array of row objects.
* **`.getRow(index)`**: Returns the row object at the specified index (0-indexed).
* **`.getHeaders()`**: Returns an array of keys (column headers) representing the table schema.
* **`.getColumn(columnKey)`**: Returns an array containing all values under the specified column key.
* **`.getCell(rowIndex, columnKey)`**: Returns the value of a specific cell.
* **`.filter(callback)`**: Returns a new `Table` instance filtered by the provided function.
* **`.map(callback)`**: Maps the rows to a new array.
* **`.count()`**: Returns the number of rows in the table.

*Example:*
```javascript
const names = inputs.my_table.getColumn("name");
const firstRow = inputs.my_table.getRow(0);
const activeUsers = inputs.my_table.filter(row => row.status === 'active');
```

#### B. `FileObject` Class
* **`.readAsText()`**: Reads the file contents synchronously as a UTF-8 string.
* **`.readAsBase64()`**: Reads the file contents synchronously and encodes it to a Base64 string.
* **`.readAsBuffer()`**: Reads the file contents synchronously into a Buffer object.
* **`.exists()`**: Returns `true` if the file exists on the filesystem.

*Example:*
```javascript
const textContent = inputs.my_file.readAsText();
const base64Content = inputs.my_file.readAsBase64();
```

#### C. `ImageObject` Class (extends `FileObject`)
* **`.toDataUri(mimeType)`**: Returns the image contents encoded as a Data URI (defaults to `image/jpeg`).

*Example:*
```javascript
const dataUri = inputs.my_image.toDataUri("image/png");
// Result: "data:image/png;base64,iVBORw0KGgoAAAANSUh..."
```

### Accessing Secrets & Credentials
Secrets configured in the Workspace are injected into `process.env`.
```javascript
const apiKey = process.env.MISTRAL_API_KEY;
```

### Returning Outputs
Return a plain JavaScript object matching the keys defined in the node's **Output Schema**:
```javascript
return {
  result_text: "Process completed",
  extracted_data: activeUsers.getRows()
};
```

---

## 2. Python Execution Environment

Python Code Nodes execute in a child process using the system's python/python3 binary. If a `main(inputs)` function is not defined, the runner automatically wraps your script inside a `def main(inputs):` block.

### Accessing Inputs
Inputs are accessed via the `inputs` dictionary:
```python
table_data = inputs['my_table']
file_meta = inputs['my_file']
text_input = inputs['text_field']
```

### Python Wrapper Helpers

#### A. `Table` Class
* **`.get_rows()`**: Returns the raw list of row dictionaries.
* **`.get_row(index)`**: Returns the dictionary at the specified index.
* **`.get_headers()`**: Returns a list of the column keys.
* **`.get_column(column_key)`**: Returns a list of all values in that column.
* **`.get_cell(row_index, column_key)`**: Returns the value of a specific cell.
* **`.filter(callback)`**: Returns a new `Table` filtered by the callback function.
* **`.map(callback)`**: Maps rows using the callback function, returning a list.
* **`.count()`**: Returns the number of rows.

*Example:*
```python
names = inputs['my_table'].get_column("name")
active_users = inputs['my_table'].filter(lambda row: row['status'] == 'active')
```

#### B. `FileObject` Class
* **`.read_as_text()`**: Reads the file as a UTF-8 string.
* **`.read_as_base64()`**: Reads the file and encodes it to a Base64 string.
* **`.exists()`**: Returns `True` if the file exists on the filesystem.

*Example:*
```python
text_content = inputs['my_file'].read_as_text()
base64_content = inputs['my_file'].read_as_base64()
```

#### C. `ImageObject` Class (extends `FileObject`)
* **`.to_data_uri(mime_type)`**: Returns the image contents encoded as a Data URI (defaults to `image/jpeg`).

*Example:*
```python
data_uri = inputs['my_image'].to_data_uri("image/png")
```

### Accessing Secrets & Credentials
Secrets configured in the Workspace are injected into environment variables:
```python
import os
api_key = os.environ.get("MISTRAL_API_KEY")
```

### Returning Outputs
Your `main(inputs)` function (or top-level script execution) must return a dictionary matching the **Output Schema**:
```python
return {
    "result_text": "Successfully processed image",
    "image_data_uri": inputs['my_image'].to_data_uri()
}
```
Custom wrapper class instances (like `Table`, `FileObject`, or `ImageObject`) returned in outputs are automatically serialized to their plain JSON representation before sending results to the flow runner.
