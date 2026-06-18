import { useState } from 'react';
import html2canvas from 'html2canvas-pro';

interface UseDashboardScreenshotParams {
  containerRef: React.RefObject<HTMLDivElement | null>;
  isDarkMode: boolean;
  flowName: string;
}

export function useDashboardScreenshot({
  containerRef,
  isDarkMode,
  flowName,
}: UseDashboardScreenshotParams) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [screenshotSuccess, setScreenshotSuccess] = useState(false);

  const handleScreenshot = async () => {
    const element = containerRef.current;
    if (!element) return;

    try {
      setIsCapturing(true);

      const canvas = await html2canvas(element, {
        backgroundColor: isDarkMode ? '#09090b' : '#ffffff',
        useCORS: true,
        logging: false,
        scale: 2,
        onclone: (clonedDoc) => {
          const originalTextareas = element.querySelectorAll('textarea');
          const clonedTextareas = clonedDoc.querySelectorAll('textarea');

          clonedTextareas.forEach((clonedTextarea, idx) => {
            const originalTextarea = originalTextareas[idx];
            if (!originalTextarea) return;

            const div = clonedDoc.createElement('div');
            const computedStyle = window.getComputedStyle(originalTextarea);
            div.style.padding = computedStyle.padding;
            div.style.fontSize = computedStyle.fontSize;
            div.style.fontFamily = computedStyle.fontFamily;
            div.style.lineHeight = computedStyle.lineHeight;
            div.style.color = computedStyle.color;
            div.style.backgroundColor = computedStyle.backgroundColor;
            div.style.border = computedStyle.border;
            div.style.borderRadius = computedStyle.borderRadius;
            div.style.boxSizing = 'border-box';
            div.style.whiteSpace = 'pre-wrap';
            div.style.wordBreak = 'break-word';
            div.style.overflowY = 'auto';
            div.style.display = 'block';
            div.style.width = originalTextarea.offsetWidth + 'px';
            div.style.height = originalTextarea.offsetHeight + 'px';

            clonedTextarea.parentNode?.replaceChild(div, clonedTextarea);
          });
        },
      });

      canvas.toBlob(async (blob) => {
        if (!blob) {
          alert('Failed to generate image from dashboard.');
          setIsCapturing(false);
          return;
        }

        try {
          const data = [new ClipboardItem({ [blob.type]: blob })];
          await navigator.clipboard.write(data);
          setScreenshotSuccess(true);
          setTimeout(() => setScreenshotSuccess(false), 2000);
        } catch (clipErr) {
          console.error('Clipboard write failed, fallback to download:', clipErr);
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `${flowName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-dashboard.png`;
          link.click();
          URL.revokeObjectURL(url);
          alert(
            'Could not copy image to clipboard automatically (browser security policy). The screenshot has been downloaded instead!'
          );
        } finally {
          setIsCapturing(false);
        }
      }, 'image/png');
    } catch (err: any) {
      console.error('Screenshot failed:', err);
      alert(`Screenshot failed: ${err.message}`);
      setIsCapturing(false);
    }
  };

  return { isCapturing, screenshotSuccess, handleScreenshot };
}
