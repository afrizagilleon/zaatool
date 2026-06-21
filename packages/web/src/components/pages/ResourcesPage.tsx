import { useEffect } from 'react';
import { useUiStore } from '../../store/uiStore';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { TabsIcon } from '@phosphor-icons/react';
import { useSecrets } from '../../hooks/useSecrets';
import { useSkills } from '../../hooks/useSkills';
import { useStorage } from '../../hooks/useStorage';
import { SecretsTab } from '../resources/SecretsTab';
import { SkillsTab } from '../resources/SkillsTab';
import { StorageTab } from '../resources/StorageTab';

export function ResourcesPage() {
  const activeTab = useUiStore((s) => s.activeTab);

  // Initialize custom hooks for separate concerns
  const { secrets, fetchSecrets, saveSecret, deleteSecret } = useSecrets();
  const { skills, fetchSkills, saveSkill, deleteSkill } = useSkills();
  const {
    files,
    currentPath,
    searchTerm,
    setSearchTerm,
    isUploading,
    uploadFile,
    createFolder,
    renameItem,
    deleteItem,
    navigateToFolder,
    navigateToIndex,
    navigateToRoot,
  } = useStorage();

  useEffect(() => {
    if (activeTab === 'resources') {
      fetchSecrets();
      fetchSkills();
    }
  }, [activeTab, fetchSecrets, fetchSkills]);

  if (activeTab !== 'resources') return null;

  return (
    <div className="flex-1 flex flex-col h-full bg-background overflow-hidden animate-in fade-in p-6">
      <div className="max-w-5xl mx-auto w-full flex-1 flex flex-col min-h-0">
        <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
          <TabsIcon className="text-primary" /> Resources
        </h1>

        <Tabs defaultValue="secrets" className="flex-1 flex flex-col min-h-0">
          <TabsList className="w-full justify-start border-b rounded-none h-10 bg-transparent p-0 gap-4">
            <TabsTrigger
              value="secrets"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-2 data-[state=active]:shadow-none text-xs"
            >
              Secrets & API Keys
            </TabsTrigger>
            <TabsTrigger
              value="skills"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-2 data-[state=active]:shadow-none text-xs"
            >
              Custom Skills
            </TabsTrigger>
            <TabsTrigger
              value="files"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-2 data-[state=active]:shadow-none text-xs"
            >
              Files / Storage
            </TabsTrigger>
          </TabsList>

          {/* Secrets tab */}
          <TabsContent value="secrets" className="flex-1 overflow-auto outline-none">
            <SecretsTab secrets={secrets} onAdd={saveSecret} onDelete={deleteSecret} />
          </TabsContent>

          {/* Skills tab */}
          <TabsContent value="skills" className="flex-1 overflow-auto outline-none">
            <SkillsTab skills={skills} onSave={saveSkill} onDelete={deleteSkill} />
          </TabsContent>

          {/* Files/Storage tab */}
          <TabsContent value="files" className="flex-1 flex flex-col min-h-0 outline-none">
            <StorageTab
              files={files}
              currentPath={currentPath}
              searchTerm={searchTerm}
              isUploading={isUploading}
              onSearchChange={setSearchTerm}
              onUpload={uploadFile}
              onCreateFolder={createFolder}
              onRename={renameItem}
              onDelete={deleteItem}
              onNavigateFolder={navigateToFolder}
              onNavigateIndex={navigateToIndex}
              onNavigateRoot={navigateToRoot}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
