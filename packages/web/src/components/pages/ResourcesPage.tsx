import { useEffect, useState } from 'react';
import { useUiStore } from '../../store/uiStore';
import { API_BASE_URL } from '../../lib/api';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Plus, Trash, Key, PencilSimple, Folder } from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Textarea } from '../ui/textarea';

interface Secret {
  id: string;
  key: string;
  value: string;
  is_secret: boolean;
  created_at: string;
}

interface Skill {
  id: string;
  name: string;
  content: string;
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
  const [skillForm, setSkillForm] = useState({ id: '', name: '', content: '' });

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
      const res = await fetch(`${API_BASE_URL}/api/resources/files`);
      if (res.ok) setFiles(await res.json());
    } catch (e) {
      console.warn('Failed to fetch files:', e);
    }
  };

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

  const saveSkill = async () => {
    try {
      const method = skillForm.id ? 'PUT' : 'POST';
      const url = skillForm.id 
        ? `${API_BASE_URL}/api/resources/skills/${skillForm.id}` 
        : `${API_BASE_URL}/api/resources/skills`;
        
      await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(skillForm),
      });
      setIsSkillDialogOpen(false);
      setSkillForm({ id: '', name: '', content: '' });
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
          <Key className="text-primary" /> Resources
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
              <Button onClick={() => { setSkillForm({id:'', name:'', content:''}); setIsSkillDialogOpen(true); }} size="sm">
                <Plus className="mr-2" size={14} /> Add Skill
              </Button>
            </div>

            <div className="border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[200px]">Name</TableHead>
                    <TableHead>Preview</TableHead>
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
                        <TableCell className="text-xs text-muted-foreground truncate max-w-md">{skill.content.slice(0, 80)}...</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" onClick={() => { setSkillForm(skill); setIsSkillDialogOpen(true); }} className="h-7 w-7 text-muted-foreground">
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
              <p className="text-sm text-muted-foreground">Uploaded files stored in MinIO object storage.</p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Folder size={14} /> MinIO Storage
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
                    files.map(file => (
                      <TableRow key={file.id}>
                        <TableCell className="text-sm font-medium">{file.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">{file.mime_type || '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatBytes(file.size_bytes)}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" onClick={() => deleteFile(file.id)} className="h-7 w-7 text-destructive hover:bg-destructive/10">
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
      <Dialog open={isSkillDialogOpen} onOpenChange={setIsSkillDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{skillForm.id ? 'Edit Skill' : 'Add Skill'}</DialogTitle>
            <DialogDescription>Provide custom instructions or code context for the AI assistant.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Name</label>
              <Input 
                placeholder="e.g., Python Data Parsing" 
                value={skillForm.name} 
                onChange={e => setSkillForm(s => ({ ...s, name: e.target.value }))} 
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Content (Markdown/Text)</label>
              <Textarea 
                placeholder="Provide instructions, context, or code examples..." 
                className="h-48 font-mono text-sm"
                value={skillForm.content} 
                onChange={e => setSkillForm(s => ({ ...s, content: e.target.value }))} 
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSkillDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveSkill} disabled={!skillForm.name || !skillForm.content}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
