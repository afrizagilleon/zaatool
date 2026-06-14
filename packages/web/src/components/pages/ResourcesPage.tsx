import { useEffect, useState, useRef } from 'react';
import { useUiStore } from '../../store/uiStore';
import { API_BASE_URL } from '../../lib/api';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Plus, Trash, PencilSimple, Folder, UploadSimple, FolderPlus, CaretRight, TabsIcon } from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { SkillEditorDialog, type Skill } from '../panels/SkillEditorDialog';

interface Secret {
  id: string;
  key: string;
  value: string;
  is_secret: boolean;
  created_at: string;
}



interface FileEntry {
  id: string;
  name: string;
  path: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

export function ResourcesPage() {
  const activeTab = useUiStore((s) => s.activeTab);
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [files, setFiles] = useState<FileEntry[]>([]);

  // Dialog state
  const [isSecretDialogOpen, setIsSecretDialogOpen] = useState(false);
  const [secretForm, setSecretForm] = useState({ key: '', value: '', is_secret: true });

  const [isSkillDialogOpen, setIsSkillDialogOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const [isFolderDialogOpen, setIsFolderDialogOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [currentPath, setCurrentPath] = useState<string[]>([]);

  useEffect(() => {
    if (activeTab === 'resources') {
      fetchSecrets();
      fetchSkills();
      fetchFiles();
    }
  }, [activeTab]);

  const fetchSecrets = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/resources/secrets`);
      if (res.ok) setSecrets(await res.json());
    } catch (e) {
      console.warn('Failed to fetch secrets:', e);
    }
  };

  const fetchSkills = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/resources/skills`);
      if (res.ok) setSkills(await res.json());
    } catch (e) {
      console.warn('Failed to fetch skills:', e);
    }
  };

  const fetchFiles = async () => {
    try {
      const dirQuery = currentPath.length > 0 ? `?dir=${encodeURIComponent(currentPath.join('/'))}` : '';
      const res = await fetch(`${API_BASE_URL}/api/resources/files${dirQuery}`);
      if (res.ok) {
        const data = await res.json();
        setFiles(data);
      }
    } catch (e) {
      console.error('Failed to fetch files:', e);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, [currentPath]);

  const saveSecret = async () => {
    try {
      await fetch(`${API_BASE_URL}/api/resources/secrets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(secretForm),
      });
      setIsSecretDialogOpen(false);
      setSecretForm({ key: '', value: '', is_secret: true });
      fetchSecrets();
    } catch (e) {
      console.error('Failed to save secret:', e);
    }
  };

  const deleteSecret = async (id: string) => {
    try {
      await fetch(`${API_BASE_URL}/api/resources/secrets/${id}`, { method: 'DELETE' });
      fetchSecrets();
    } catch (e) {
      console.error('Failed to delete secret:', e);
    }
  };

  const saveSkill = async (skill: Skill) => {
    try {
      const method = skill.id ? 'PUT' : 'POST';
      const url = skill.id
        ? `${API_BASE_URL}/api/resources/skills/${skill.id}`
        : `${API_BASE_URL}/api/resources/skills`;

      await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(skill),
      });
      setIsSkillDialogOpen(false);
      setEditingSkill(null);
      fetchSkills();
    } catch (e) {
      console.error('Failed to save skill:', e);
    }
  };

  const deleteSkill = async (id: string) => {
    try {
      await fetch(`${API_BASE_URL}/api/resources/skills/${id}`, { method: 'DELETE' });
      fetchSkills();
    } catch (e) {
      console.error('Failed to delete skill:', e);
    }
  };

  const deleteFile = async (id: string) => {
    try {
      await fetch(`${API_BASE_URL}/api/resources/files/${id}`, { method: 'DELETE' });
      fetchFiles();
    } catch (e) {
      console.error('Failed to delete file:', e);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const dirQuery = currentPath.length > 0 ? `?dir=${encodeURIComponent(currentPath.join('/'))}` : '';
      const res = await fetch(`${API_BASE_URL}/api/resources/files${dirQuery}`, {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        fetchFiles();
      } else {
        console.error('Upload failed');
      }
    } catch (err) {
      console.error('Failed to upload file:', err);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const createFolder = async () => {
    if (!folderName.trim()) return;
    try {
      const dirParam = currentPath.length > 0 ? currentPath.join('/') : '';
      const res = await fetch(`${API_BASE_URL}/api/resources/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: folderName.trim(), dir: dirParam }),
      });
      if (res.ok) {
        setIsFolderDialogOpen(false);
        setFolderName('');
        fetchFiles();
      }
    } catch (err) {
      console.error('Failed to create folder:', err);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  if (activeTab !== 'resources') return null;

  return (
    <div className="flex-1 flex flex-col h-full bg-background overflow-hidden animate-in fade-in p-6">
      <div className="max-w-5xl mx-auto w-full flex-1 flex flex-col">
        <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
          <TabsIcon className="text-primary" /> Resources
        </h1>

        <Tabs defaultValue="secrets" className="flex-1 flex flex-col min-h-0">
          <TabsList className="w-full justify-start border-b rounded-none h-10 bg-transparent p-0 gap-4">
            <TabsTrigger
              value="secrets"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-2 data-[state=active]:shadow-none"
            >
              Secrets & API Keys
            </TabsTrigger>
            <TabsTrigger
              value="skills"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-2 data-[state=active]:shadow-none"
            >
              Custom Skills
            </TabsTrigger>
            <TabsTrigger
              value="files"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-2 data-[state=active]:shadow-none"
            >
              Files / Storage
            </TabsTrigger>
          </TabsList>

          {/* SECRETS TAB */}
          <TabsContent value="secrets" className="flex-1 overflow-auto py-6 m-0 border-none outline-none">
            <div className="flex justify-between items-center mb-4">
              <p className="text-sm text-muted-foreground">Manage your API keys and environment variables securely.</p>
              <Button onClick={() => setIsSecretDialogOpen(true)} size="sm">
                <Plus className="mr-2" size={14} /> Add Secret
              </Button>
            </div>

            <div className="border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[300px]">Key</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead className="w-[100px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {secrets.length === 0 ? (
                    <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground h-24">No secrets found</TableCell></TableRow>
                  ) : (
                    secrets.map(secret => (
                      <TableRow key={secret.id}>
                        <TableCell className="font-mono text-xs">{secret.key}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{secret.value}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" onClick={() => deleteSecret(secret.id)} className="h-7 w-7 text-destructive hover:bg-destructive/10">
                            <Trash size={14} />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* SKILLS TAB */}
          <TabsContent value="skills" className="flex-1 overflow-auto py-6 m-0 border-none outline-none">
            <div className="flex justify-between items-center mb-4">
              <p className="text-sm text-muted-foreground">Provide custom instructions or context for the AI Code-Gen.</p>
              <Button onClick={() => { setEditingSkill(null); setIsSkillDialogOpen(true); }} size="sm">
                <Plus className="mr-2" size={14} /> Add Skill
              </Button>
            </div>

            <div className="border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[200px]">Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-[100px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {skills.length === 0 ? (
                    <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground h-24">No skills found</TableCell></TableRow>
                  ) : (
                    skills.map(skill => (
                      <TableRow key={skill.id}>
                        <TableCell className="font-medium text-sm">{skill.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground truncate max-w-md">{skill.description || <span className="italic opacity-50">No description</span>}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" onClick={() => { setEditingSkill(skill); setIsSkillDialogOpen(true); }} className="h-7 w-7 text-muted-foreground">
                            <PencilSimple size={14} />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => deleteSkill(skill.id)} className="h-7 w-7 text-destructive hover:bg-destructive/10">
                            <Trash size={14} />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* FILES TAB */}
          <TabsContent value="files" className="flex-1 overflow-auto py-6 m-0 border-none outline-none">
            <div className="flex justify-between items-center mb-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Local file system storage mapped to node access.</p>
                <div className="flex items-center gap-1 text-sm font-medium">
                  <button
                    onClick={() => setCurrentPath([])}
                    className="hover:text-primary transition-colors hover:underline"
                  >
                    Storage
                  </button>
                  {currentPath.map((part, idx) => (
                    <div key={idx} className="flex items-center gap-1">
                      <CaretRight size={12} className="text-muted-foreground" />
                      <button
                        onClick={() => setCurrentPath(currentPath.slice(0, idx + 1))}
                        className="hover:text-primary transition-colors hover:underline"
                      >
                        {part}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileChange} />
                <Button size="sm" variant="outline" onClick={() => setIsFolderDialogOpen(true)}>
                  <FolderPlus size={14} className="mr-2" />
                  New Folder
                </Button>
                <Button size="sm" onClick={handleUploadClick} disabled={isUploading}>
                  <UploadSimple size={14} className="mr-2" />
                  {isUploading ? 'Uploading...' : 'Upload File'}
                </Button>
              </div>
            </div>

            <div className="border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-[120px]">Type</TableHead>
                    <TableHead className="w-[100px]">Size</TableHead>
                    <TableHead className="w-[100px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {files.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground h-24">No files uploaded yet</TableCell></TableRow>
                  ) : (
                    files.map(file => {
                      const isFolder = file.mime_type === 'inode/directory';
                      return (
                        <TableRow
                          key={file.id}
                          className={isFolder ? "cursor-pointer hover:bg-muted/50 transition-colors group" : ""}
                          onClick={() => { if (isFolder) setCurrentPath([...currentPath, file.name]); }}
                        >
                          <TableCell className="text-sm font-medium">
                            <div className="flex items-center gap-2 group-hover:text-primary transition-colors">
                              {isFolder ? <Folder size={16} weight="fill" className="text-muted-foreground group-hover:text-primary transition-colors" /> : null}
                              {file.name}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground font-mono">{file.mime_type || '—'}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{isFolder ? '—' : formatBytes(file.size_bytes)}</TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); deleteFile(file.id); }} className="h-7 w-7 text-destructive hover:bg-destructive/10">
                              <Trash size={14} />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Dialog for Secrets */}
      <Dialog open={isSecretDialogOpen} onOpenChange={setIsSecretDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Secret</DialogTitle>
            <DialogDescription>Store API keys and environment variables securely.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Key</label>
              <Input
                placeholder="OPENROUTER_API_KEY"
                value={secretForm.key}
                onChange={e => setSecretForm(s => ({ ...s, key: e.target.value.toUpperCase().replace(/\s+/g, '_') }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Value</label>
              <Input
                type="password"
                placeholder="sk-or-v1-..."
                value={secretForm.value}
                onChange={e => setSecretForm(s => ({ ...s, value: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSecretDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveSecret} disabled={!secretForm.key || !secretForm.value}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog for Skills */}
      <SkillEditorDialog
        open={isSkillDialogOpen}
        onOpenChange={setIsSkillDialogOpen}
        skill={editingSkill}
        onSave={saveSkill}
      />

      {/* Dialog for Folders */}
      <Dialog open={isFolderDialogOpen} onOpenChange={setIsFolderDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Folder</DialogTitle>
            <DialogDescription>Add a new folder to organize your files.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="e.g. dataset-v1"
              value={folderName}
              onChange={e => setFolderName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') createFolder(); }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsFolderDialogOpen(false)}>Cancel</Button>
            <Button onClick={createFolder} disabled={!folderName.trim()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
