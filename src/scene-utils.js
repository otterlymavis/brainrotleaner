const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

export const SCENE_MIN_DURATION = 0.5;
export const SCENE_MAX_DURATION = 60;

export const makeSceneId = () => `scene-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const normalizeScene = (scene, index = 0) => ({
  id: String(scene?.id || makeSceneId()),
  title: String(scene?.title || `Part ${index + 1}`).trim() || `Part ${index + 1}`,
  text: String(scene?.text || "").trim(),
  duration: clamp(Number(scene?.duration) || 5.4, SCENE_MIN_DURATION, SCENE_MAX_DURATION)
});

export const toEditableScenes = (scenes = []) => scenes.map((scene, index) => normalizeScene({ ...scene, id: scene?.id || makeSceneId() }, index));

export const normalizeEditableScenes = (scenes = []) => scenes.map(normalizeScene).filter((scene) => scene.text);

export const sceneTotalSeconds = (scenes = []) => scenes.reduce((sum, scene) => sum + (Number(scene?.duration) || 0), 0);

export const moveScene = (scenes, index, direction) => {
  const target = index + direction;
  if (index < 0 || index >= scenes.length || target < 0 || target >= scenes.length) return scenes;
  const next = [...scenes];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
};
