import { useState, useCallback } from 'react';
import { API_BASE_URL } from '../lib/api.js';
import type { Skill } from '../components/panels/SkillEditorDialog.js';

export function useSkills() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchSkills = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/resources/skills`);
      if (res.ok) {
        setSkills(await res.json());
      }
    } catch (e) {
      console.warn('Failed to fetch skills:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const saveSkill = useCallback(async (skill: Skill) => {
    try {
      const method = skill.id ? 'PUT' : 'POST';
      const url = skill.id
        ? `${API_BASE_URL}/api/resources/skills/${skill.id}`
        : `${API_BASE_URL}/api/resources/skills`;

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(skill),
      });

      if (res.ok) {
        await fetchSkills();
        return true;
      }
    } catch (e) {
      console.error('Failed to save skill:', e);
    }
    return false;
  }, [fetchSkills]);

  const deleteSkill = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/resources/skills/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        await fetchSkills();
        return true;
      }
    } catch (e) {
      console.error('Failed to delete skill:', e);
    }
    return false;
  }, [fetchSkills]);

  return {
    skills,
    isLoading,
    fetchSkills,
    saveSkill,
    deleteSkill,
  };
}
