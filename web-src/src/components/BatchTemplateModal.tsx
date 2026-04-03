import { useState, useEffect } from 'react';
import { X, FolderOpen, FileSpreadsheet, Loader2, Check, ChevronRight, Image, Film, Sparkles, FolderInput } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface BatchTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const TASK_TYPES = [
  { id: 'Create Image', label: '文生图片', icon: Image, description: '根据图片生成新图片' },
  { id: 'Frames to Video', label: '首尾帧视频', icon: Film, description: '根据首尾帧生成视频' },
  { id: 'Ingredients to Video', label: '图生视频', icon: Sparkles, description: '根据图片素材生成视频' },
];

const IMAGE_ASPECT_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16'];
const VIDEO_ASPECT_RATIOS = ['9:16', '16:9'];
const IMAGE_COUNTS = ['x1', 'x2', 'x3', 'x4'];
const IMAGE_MODELS = ['Nano Banana 2', 'Nano Banana Pro', 'Imagen 4'];
const VIDEO_COUNTS = ['x1', 'x2', 'x3', 'x4'];
const VIDEO_MODELS = ['Veo 3.1 - Fast [Lower Priority]', 'Veo 3.1 - Lite', 'Veo 3.1 - Fast', 'Veo 3.1 - Quality'];

export function BatchTemplateModal({ isOpen, onClose }: BatchTemplateModalProps) {
  const [step, setStep] = useState(1);
  const [folderPath, setFolderPath] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [taskType, setTaskType] = useState('Create Image');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [imageCount, setImageCount] = useState('x1');
  const [imageModel, setImageModel] = useState('Nano Banana 2');
  const [videoCount, setVideoCount] = useState('x1');
  const [videoModel, setVideoModel] = useState('Veo 3.1 - Fast [Lower Priority]');
  const [outputDir, setOutputDir] = useState('');
  const [defaultPrompt, setDefaultPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pickingOutput, setPickingOutput] = useState(false);

  const api = typeof window !== 'undefined' ? window.pywebview?.api : null;

  const aspectOptions = taskType === 'Create Image' ? IMAGE_ASPECT_RATIOS : VIDEO_ASPECT_RATIOS;
  const encodedResolution =
    taskType === 'Create Image'
      ? `${imageCount}|${imageModel}`
      : `${videoCount}|${videoModel}`;

  useEffect(() => {
    if (!isOpen) {
      setStep(1);
      setFolderPath('');
      setImages([]);
      setTaskType('Create Image');
      setAspectRatio('16:9');
      setImageCount('x1');
      setImageModel('Nano Banana 2');
      setVideoCount('x1');
      setVideoModel('Veo 3.1 - Fast [Lower Priority]');
      setOutputDir('');
      setDefaultPrompt('');
      setLoading(false);
      setGenerating(false);
      setPickingOutput(false);
    }
  }, [isOpen]);

  useEffect(() => {
    const opts = taskType === 'Create Image' ? IMAGE_ASPECT_RATIOS : VIDEO_ASPECT_RATIOS;
    if (!opts.includes(aspectRatio)) {
      setAspectRatio(opts[0]);
    }
  }, [taskType, aspectRatio]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSelectFolder = async () => {
    if (!api || loading) return;
    setLoading(true);
    try {
      const result = await (api as { select_image_folder: () => Promise<{ success: boolean; folder_path?: string; images?: string[]; error?: string }> }).select_image_folder();
      if (result.success && result.folder_path) {
        setFolderPath(result.folder_path);
        setImages(result.images || []);
        if ((result.images || []).length > 0) setStep(2);
      } else if (result.error) {
        alert(result.error);
      }
    } catch (e) {
      console.error('选择文件夹失败:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectOutputDir = async () => {
    if (!api || pickingOutput) return;
    setPickingOutput(true);
    try {
      const result = await (api as { select_output_folder: () => Promise<{ success: boolean; path?: string; error?: string }> }).select_output_folder();
      if (result.success && result.path) setOutputDir(result.path);
      else if (result.error) alert(result.error);
    } catch (e) {
      console.error('选择输出目录失败:', e);
    } finally {
      setPickingOutput(false);
    }
  };

  const handleGenerate = async () => {
    if (!api || generating || images.length === 0) return;
    const p = defaultPrompt.trim();
    if (!p) {
      alert('请填写默认提示词');
      return;
    }

    setGenerating(true);
    try {
      const result = await (api as {
        create_custom_template: (
          a: string[],
          b: string,
          c: string,
          d: string,
          e: string,
          f: string
        ) => Promise<{ success: boolean; count?: number; error?: string }>;
      }).create_custom_template(images, taskType, aspectRatio, encodedResolution, outputDir, p);

      if (result.success) {
        alert(`模板创建成功！包含 ${result.count} 个任务`);
        onClose();
      } else {
        alert(result.error || '创建失败');
      }
    } catch (e) {
      console.error('创建模板失败:', e);
      alert('创建模板失败');
    } finally {
      setGenerating(false);
    }
  };

  const goNext = () => {
    if (step === 2) {
      if (!defaultPrompt.trim()) {
        alert('请填写默认提示词');
        return;
      }
    }
    setStep((s) => s + 1);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col"
        >
          <div className="flex items-center justify-between p-5 border-b border-zinc-100 shrink-0">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900">创建简单模板</h2>
              <p className="text-sm text-zinc-500 mt-0.5">
                步骤 {step}/3：{step === 1 ? '选择图片文件夹' : step === 2 ? '配置任务参数' : '确认生成'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 transition-colors"
            >
              <X className="w-5 h-5 text-zinc-500" />
            </button>
          </div>

          <div className="p-5 min-h-[280px] overflow-y-auto flex-1">
            <AnimatePresence mode="wait">
              {step === 1 && (
                <motion.div
                  key="step1"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="space-y-4"
                >
                  <button
                    type="button"
                    onClick={handleSelectFolder}
                    disabled={loading}
                    className={`w-full border-2 border-dashed rounded-2xl p-8 text-center transition-colors ${
                      loading ? 'border-violet-300 bg-violet-50' : 'border-zinc-200 hover:border-violet-300'
                    }`}
                  >
                    <div
                      className={`w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center ${
                        loading ? 'bg-violet-100' : 'bg-zinc-100'
                      }`}
                    >
                      {loading ? (
                        <Loader2 className="w-8 h-8 text-violet-600 animate-spin" />
                      ) : (
                        <FolderOpen className="w-8 h-8 text-zinc-400" />
                      )}
                    </div>
                    <p className="text-sm font-medium text-zinc-700 mb-1">
                      {loading ? '正在扫描...' : '点击选择图片文件夹'}
                    </p>
                    <p className="text-xs text-zinc-400">支持 .jpg, .jpeg, .png, .webp 格式</p>
                  </button>

                  {folderPath && images.length === 0 && (
                    <div className="bg-orange-50 text-orange-600 p-4 rounded-xl text-sm">
                      选择的文件夹中没有找到图片文件
                    </div>
                  )}

                  {images.length > 0 && (
                    <div className="bg-emerald-50 text-emerald-600 p-4 rounded-xl text-sm flex items-center justify-between">
                      <span>已扫描到 {images.length} 张图片</span>
                      <Check className="w-5 h-5" />
                    </div>
                  )}
                </motion.div>
              )}

              {step === 2 && (
                <motion.div
                  key="step2"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-5"
                >
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-2">任务类型</label>
                    <div className="space-y-2">
                      {TASK_TYPES.map((type) => {
                        const Icon = type.icon;
                        return (
                          <button
                            key={type.id}
                            type="button"
                            onClick={() => setTaskType(type.id)}
                            className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                              taskType === type.id
                                ? 'border-violet-500 bg-violet-50'
                                : 'border-zinc-200 hover:border-zinc-300'
                            }`}
                          >
                            <div
                              className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                                taskType === type.id ? 'bg-violet-100' : 'bg-zinc-100'
                              }`}
                            >
                              <Icon
                                className={`w-5 h-5 ${
                                  taskType === type.id ? 'text-violet-600' : 'text-zinc-400'
                                }`}
                              />
                            </div>
                            <div className="flex-1 text-left">
                              <p
                                className={`text-sm font-medium ${
                                  taskType === type.id ? 'text-violet-700' : 'text-zinc-700'
                                }`}
                              >
                                {type.label}
                              </p>
                              <p className="text-xs text-zinc-400">{type.description}</p>
                            </div>
                            {taskType === type.id && <Check className="w-5 h-5 text-violet-500" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-2">宽高比</label>
                    <div className="flex flex-wrap gap-2">
                      {aspectOptions.map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setAspectRatio(r)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                            aspectRatio === r
                              ? 'bg-violet-600 text-white border-violet-600'
                              : 'bg-zinc-50 text-zinc-600 border-zinc-200 hover:border-zinc-300'
                          }`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>

                  {taskType === 'Create Image' ? (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-zinc-700 mb-2">张数</label>
                        <div className="flex flex-wrap gap-2">
                          {IMAGE_COUNTS.map((c) => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => setImageCount(c)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                                imageCount === c
                                  ? 'bg-violet-600 text-white border-violet-600'
                                  : 'bg-zinc-50 text-zinc-600 border-zinc-200 hover:border-zinc-300'
                              }`}
                            >
                              {c}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-zinc-700 mb-2">模型</label>
                        <div className="flex flex-col gap-2">
                          {IMAGE_MODELS.map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => setImageModel(m)}
                              className={`text-left px-3 py-2 rounded-lg text-sm border transition-colors ${
                                imageModel === m
                                  ? 'bg-violet-50 border-violet-500 text-violet-800'
                                  : 'bg-zinc-50 border-zinc-200 text-zinc-700 hover:border-zinc-300'
                              }`}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-zinc-700 mb-2">数量</label>
                        <div className="flex flex-wrap gap-2">
                          {VIDEO_COUNTS.map((c) => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => setVideoCount(c)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                                videoCount === c
                                  ? 'bg-violet-600 text-white border-violet-600'
                                  : 'bg-zinc-50 text-zinc-600 border-zinc-200 hover:border-zinc-300'
                              }`}
                            >
                              {c}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-zinc-700 mb-2">模型</label>
                        <div className="flex flex-col gap-2">
                          {VIDEO_MODELS.map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => setVideoModel(m)}
                              className={`text-left px-3 py-2 rounded-lg text-sm border transition-colors ${
                                videoModel === m
                                  ? 'bg-violet-50 border-violet-500 text-violet-800'
                                  : 'bg-zinc-50 border-zinc-200 text-zinc-700 hover:border-zinc-300'
                              }`}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-2">
                      默认提示词 <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={defaultPrompt}
                      onChange={(e) => setDefaultPrompt(e.target.value)}
                      placeholder="必填，将写入模板每一行，可在 Excel 中再按图修改"
                      rows={3}
                      className="w-full px-4 py-3 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:border-violet-300 focus:ring-4 focus:ring-violet-100 resize-none"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-2">输出文件夹</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        readOnly
                        value={outputDir}
                        placeholder="可选，点击右侧按钮选择；留空为默认输出目录"
                        className="flex-1 min-w-0 px-4 py-3 rounded-xl border border-zinc-200 text-sm bg-zinc-50 text-zinc-700"
                      />
                      <button
                        type="button"
                        onClick={handleSelectOutputDir}
                        disabled={pickingOutput}
                        className="shrink-0 flex items-center gap-2 px-4 py-3 rounded-xl border border-violet-200 bg-violet-50 text-violet-700 text-sm font-medium hover:bg-violet-100 disabled:opacity-50"
                      >
                        {pickingOutput ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderInput className="w-4 h-4" />}
                        选择
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}

              {step === 3 && (
                <motion.div
                  key="step3"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-4"
                >
                  <div className="bg-zinc-50 rounded-2xl p-5 space-y-3 text-sm">
                    <div className="flex justify-between py-2 border-b border-zinc-200">
                      <span className="text-zinc-500">图片数量</span>
                      <span className="font-medium text-zinc-900">{images.length} 张</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-zinc-200">
                      <span className="text-zinc-500">任务类型</span>
                      <span className="font-medium text-zinc-900">
                        {TASK_TYPES.find((t) => t.id === taskType)?.label}
                      </span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-zinc-200">
                      <span className="text-zinc-500">宽高比</span>
                      <span className="font-medium text-zinc-900">{aspectRatio}</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-zinc-200">
                      <span className="text-zinc-500">数量与模型</span>
                      <span className="font-medium text-zinc-900 text-right break-all max-w-[200px]">
                        {encodedResolution}
                      </span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-zinc-200">
                      <span className="text-zinc-500">默认提示词</span>
                      <span className="font-medium text-zinc-900 truncate max-w-[200px]">{defaultPrompt.trim()}</span>
                    </div>
                    <div className="flex justify-between py-2">
                      <span className="text-zinc-500">输出文件夹</span>
                      <span className="font-medium text-zinc-900 truncate max-w-[200px] text-right">
                        {outputDir || '默认目录'}
                      </span>
                    </div>
                  </div>

                  <div className="bg-amber-50 text-amber-800 p-4 rounded-xl text-sm">
                    <p>将创建包含 {images.length} 行任务的 Excel 模板，每行对应一张图片。</p>
                    <p className="mt-1 font-medium">可在 Excel 中按行修改提示词后再导入。</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="flex items-center justify-between p-5 border-t border-zinc-100 bg-zinc-50 shrink-0">
            <button
              type="button"
              onClick={() => (step > 1 ? setStep(step - 1) : onClose())}
              className="px-4 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-900 transition-colors"
            >
              {step > 1 ? '上一步' : '取消'}
            </button>

            {step < 3 ? (
              <button
                type="button"
                onClick={goNext}
                disabled={step === 1 && images.length === 0}
                className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white rounded-xl text-sm font-medium hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                下一步
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating}
                className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {generating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    生成中...
                  </>
                ) : (
                  <>
                    <FileSpreadsheet className="w-4 h-4" />
                    生成模板
                  </>
                )}
              </button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
