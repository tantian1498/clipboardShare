/**
 * 跨电脑剪贴板 - 前端逻辑
 * 无 ?. 与 ?? 语法（兼容性要求）
 */
(function () {
  var SAVE_DELAY_MS = 500;
  var POLL_INTERVAL_MS = 2500; /* 定时拉取服务器内容，实现另一端更新后本端自动同步 */
  var saveTimer = null;

  var textEl = document.getElementById('text');
  var copyBtn = document.getElementById('copyBtn');
  var clearBtn = document.getElementById('clearBtn');
  var toastEl = document.getElementById('toast');
  var hostBox = document.getElementById('hostBox');
  var hostUrlEl = document.getElementById('hostUrl');
  var imagesWrap = document.getElementById('imagesWrap');
  var imagesSection = document.getElementById('imagesSection');
  var filesWrap = document.getElementById('filesWrap');
  var filesSection = document.getElementById('filesSection');
  var uploadBtn = document.getElementById('uploadBtn');
  var fileInput = document.getElementById('fileInput');
  var uploadSection = document.getElementById('uploadSection');

  /** 本地缓存的图片列表（data URL），与服务器同步 */
  var images = [];
  /** 本地缓存的文件列表，与服务器同步 */
  var files = [];
  /** 文件是否存在未同步到服务端的变更 */
  var filesDirty = false;

  function showToast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastEl._hideTimer);
    toastEl._hideTimer = setTimeout(function () {
      toastEl.classList.remove('show');
    }, 2000);
  }

  function loadHostUrl() {
    if (!hostUrlEl) return;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/host', true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          try {
            var data = JSON.parse(xhr.responseText);
            var urls = data && data.urls && data.urls.length > 0 ? data.urls : [];
            if (urls.length > 0) {
              hostUrlEl.innerHTML = '';
              for (var i = 0; i < urls.length; i++) {
                var span = document.createElement('div');
                span.className = 'url';
                span.textContent = urls[i];
                hostUrlEl.appendChild(span);
              }
            } else {
              hostUrlEl.textContent = '无法获取本机 IP';
            }
          } catch (e) {
            hostUrlEl.textContent = '获取失败';
          }
        } else {
          hostUrlEl.textContent = '获取失败';
        }
      }
    };
    xhr.send();
  }

  function formatSize(size) {
    if (typeof size !== 'number' || size < 0) return '-';
    if (size < 1024) return size + ' B';
    if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
    return (size / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function isValidFileItem(item) {
    return !!(item &&
      typeof item.name === 'string' &&
      item.name &&
      typeof item.dataUrl === 'string' &&
      item.dataUrl.indexOf('data:') === 0);
  }

  /**
   * 从服务器加载完整内容（文本 + 图片）并更新界面。
   * 若 /api/content 不存在（404）则回退到 /api/text，仅加载文本。
   */
  function loadContent() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/content', true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          if (data) {
            if (textEl && typeof data.text === 'string') textEl.value = data.text;
            images = Array.isArray(data.images) ? data.images : [];
            if (Array.isArray(data.files)) {
              files = data.files.filter(isValidFileItem);
              filesDirty = false;
            }
            renderImages();
            renderFiles();
          }
        } catch (e) {
          console.error('解析服务器内容失败', e);
        }
        return;
      }
      if (xhr.status === 404) {
        var fallback = new XMLHttpRequest();
        fallback.open('GET', '/api/text', true);
        fallback.onreadystatechange = function () {
          if (fallback.readyState === 4 && fallback.status === 200) {
            try {
              var data = JSON.parse(fallback.responseText);
              if (textEl && data && typeof data.text === 'string') textEl.value = data.text;
              images = [];
              files = [];
              renderImages();
              renderFiles();
            } catch (e) {}
          }
        };
        fallback.send();
      }
    };
    xhr.send();
  }

  /**
   * 从服务器拉取最新内容并同步；仅当输入框未获得焦点时更新文本。
   * 若 /api/content 返回 404 则用 /api/text 仅同步文本。
   */
  function syncContentFromServer() {
    if (!textEl) return;
    var textFocused = document.activeElement === textEl;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/content', true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          if (!data) return;
          if (!textFocused && typeof data.text === 'string' && textEl.value !== data.text) {
            textEl.value = data.text;
          }
          var serverImages = Array.isArray(data.images) ? data.images : [];
          var same = serverImages.length === images.length;
          if (same) {
            for (var i = 0; i < serverImages.length; i++) {
              if (serverImages[i] !== images[i]) { same = false; break; }
            }
          }
          if (!same) {
            images = serverImages;
            renderImages();
          }
          if (Array.isArray(data.files)) {
            var serverFilesRaw = data.files;
            var serverFiles = serverFilesRaw.filter(isValidFileItem);
            if (filesDirty && serverFiles.length === 0 && files.length > 0) {
              return;
            }
            var sameFiles = serverFiles.length === files.length;
            if (sameFiles) {
              for (var fi = 0; fi < serverFiles.length; fi++) {
                var a = serverFiles[fi];
                var b = files[fi];
                if (!b || a.name !== b.name || a.size !== b.size || a.type !== b.type || a.dataUrl !== b.dataUrl) {
                  sameFiles = false;
                  break;
                }
              }
            }
            if (!sameFiles) {
              files = serverFiles;
              renderFiles();
              filesDirty = false;
            } else {
              filesDirty = false;
            }
          }
        } catch (e) { /* 轮询静默失败 */ }
        return;
      }
      if (xhr.status === 404) {
        var fallback = new XMLHttpRequest();
        fallback.open('GET', '/api/text', true);
        fallback.onreadystatechange = function () {
          if (fallback.readyState === 4 && fallback.status === 200 && !textFocused) {
            try {
              var data = JSON.parse(fallback.responseText);
              if (data && typeof data.text === 'string' && textEl.value !== data.text) {
                textEl.value = data.text;
              }
            } catch (e) {}
          }
        };
        fallback.send();
      }
    };
    xhr.send();
  }

  /**
   * 将当前文本与图片列表保存到服务器
   */
  function saveContent() {
    var text = textEl ? textEl.value : '';
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/content', true);
    xhr.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 200) {
        filesDirty = false;
        return;
      }
      if (xhr.status === 404) {
        var fallback = new XMLHttpRequest();
        fallback.open('POST', '/api/text', true);
        fallback.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
        fallback.onreadystatechange = function () {
          if (fallback.readyState === 4 && fallback.status === 200) {
            filesDirty = false;
          }
        };
        fallback.send(JSON.stringify({ text: text }));
        return;
      }
      if (filesDirty) showToast('文件保存失败（状态码 ' + xhr.status + '）');
    };
    xhr.onerror = function () {
      if (filesDirty) showToast('文件保存失败（网络异常）');
    };
    xhr.send(JSON.stringify({ text: text, images: images, files: files }));
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      saveContent();
    }, SAVE_DELAY_MS);
  }

  /**
   * 根据 images 数组渲染图片列表，每张图带「复制」按钮
   */
  function renderImages() {
    if (!imagesWrap) return;
    imagesWrap.innerHTML = '';
    if (imagesSection) imagesSection.style.display = images.length > 0 ? '' : 'none';
    for (var i = 0; i < images.length; i++) {
      (function (idx, dataUrl) {
        var card = document.createElement('div');
        card.className = 'img-card';
        var img = document.createElement('img');
        img.src = dataUrl;
        img.alt = '图片 ' + (idx + 1);
        var actions = document.createElement('div');
        actions.className = 'img-actions';
        var copyImgBtn = document.createElement('button');
        copyImgBtn.type = 'button';
        copyImgBtn.className = 'btn btn-copy btn-small';
        copyImgBtn.textContent = '复制';
        copyImgBtn.addEventListener('click', function () { copyImageToClipboard(dataUrl); });
        var dlBtn = document.createElement('button');
        dlBtn.type = 'button';
        dlBtn.className = 'btn btn-small';
        dlBtn.style.background = 'var(--border)';
        dlBtn.style.color = 'var(--text)';
        dlBtn.textContent = '下载';
        dlBtn.addEventListener('click', function () {
          downloadImage(dataUrl);
          showToast('已下载图片');
        });
        actions.appendChild(copyImgBtn);
        actions.appendChild(dlBtn);
        card.appendChild(img);
        card.appendChild(actions);
        imagesWrap.appendChild(card);
      })(i, images[i]);
    }
  }

  function renderFiles() {
    if (!filesWrap) return;
    filesWrap.innerHTML = '';
    if (filesSection) filesSection.style.display = files.length > 0 ? '' : 'none';
    for (var i = 0; i < files.length; i++) {
      (function (fileItem, idx) {
        var card = document.createElement('div');
        card.className = 'file-card';

        var left = document.createElement('div');
        var name = document.createElement('div');
        name.className = 'file-name';
        name.textContent = fileItem.name;

        var meta = document.createElement('div');
        meta.className = 'file-meta';
        meta.textContent = (fileItem.type || '未知类型') + ' | ' + formatSize(fileItem.size || 0);

        left.appendChild(name);
        left.appendChild(meta);

        var dlBtn = document.createElement('button');
        dlBtn.type = 'button';
        dlBtn.className = 'btn btn-small';
        dlBtn.style.background = 'var(--border)';
        dlBtn.style.color = 'var(--text)';
        dlBtn.textContent = '下载';
        dlBtn.addEventListener('click', function () {
          downloadFile(fileItem, idx);
        });

        card.appendChild(left);
        card.appendChild(dlBtn);
        filesWrap.appendChild(card);
      })(files[i], i);
    }
  }

  /**
   * 将 data URL 转为 PNG Blob（统一类型，便于剪贴板写入）
   */
  function dataUrlToPngBlob(dataUrl, callback) {
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      var canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(function (blob) {
        callback(blob);
      }, 'image/png');
    };
    img.onerror = function () {
      fetch(dataUrl).then(function (r) { return r.blob(); }).then(function (blob) {
        callback(blob);
      }).catch(function () { callback(null); });
    };
    img.src = dataUrl;
  }

  /**
   * 尝试通过 contenteditable + execCommand 复制图片（HTTP 等环境下的回退）
   */
  function copyImageViaExecCommand(dataUrl) {
    var range = document.createRange();
    var div = document.createElement('div');
    div.contentEditable = 'true';
    div.style.position = 'fixed';
    div.style.left = '-9999px';
    var img = document.createElement('img');
    img.src = dataUrl;
    div.appendChild(img);
    document.body.appendChild(div);
    range.selectNodeContents(div);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    var ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e) {}
    sel.removeAllRanges();
    document.body.removeChild(div);
    return ok;
  }

  /**
   * 将一张图片（data URL）写入系统剪贴板；失败时尝试回退或触发下载
   */
  function copyImageToClipboard(dataUrl) {
    dataUrlToPngBlob(dataUrl, function (blob) {
      if (!blob) {
        downloadImage(dataUrl);
        showToast('复制失败，已改为下载图片');
        return;
      }
      var mime = blob.type && blob.type.indexOf('image') !== -1 ? blob.type : 'image/png';
      var item = {};
      item[mime] = blob;

      function tryClipboardApi() {
        if (typeof navigator.clipboard !== 'undefined' && navigator.clipboard.write) {
          return navigator.clipboard.write([new ClipboardItem(item)]).then(function () {
            showToast('图片已复制到剪贴板');
            return true;
          });
        }
        return Promise.resolve(false);
      }

      function tryFallback() {
        if (copyImageViaExecCommand(dataUrl)) {
          showToast('图片已复制到剪贴板');
          return true;
        }
        return false;
      }

      tryClipboardApi()
        .then(function (done) {
          if (done) return;
          if (!tryFallback()) {
            downloadImage(dataUrl);
            showToast('复制失败，已改为下载图片');
          }
        })
        .catch(function () {
          if (!tryFallback()) {
            downloadImage(dataUrl);
            showToast('复制失败，已改为下载图片');
          }
        });
    });
  }

  /**
   * 触发图片下载到本地
   */
  function downloadImage(dataUrl) {
    var a = document.createElement('a');
    a.href = dataUrl;
    a.download = 'clipboard-image-' + Date.now() + '.png';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function downloadFile(fileItem, idx) {
    if (!isValidFileItem(fileItem)) {
      showToast('文件数据无效');
      return;
    }
    var a = document.createElement('a');
    a.href = fileItem.dataUrl;
    a.download = fileItem.name || ('clipboard-file-' + (idx + 1));
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('已开始下载文件');
  }

  function addFileFromList(fileList) {
    if (!fileList || !fileList.length) return;
    var pending = 0;
    var added = 0;
    var i;
    for (i = 0; i < fileList.length; i++) {
      (function (file) {
        if (!file) return;
        pending += 1;
        var reader = new FileReader();
        reader.onload = function (e) {
          var dataUrl = e && e.target ? e.target.result : '';
          if (typeof dataUrl === 'string') {
            filesDirty = true;
            files.push({
              name: file.name,
              type: file.type || 'application/octet-stream',
              size: file.size,
              dataUrl: dataUrl
            });
            added += 1;
          }
          pending -= 1;
          if (pending === 0) {
            renderFiles();
            saveContent();
            if (added > 0) showToast('已上传 ' + added + ' 个文件');
          }
        };
        reader.onerror = function () {
          pending -= 1;
          if (pending === 0) {
            renderFiles();
            saveContent();
          }
        };
        reader.readAsDataURL(file);
      })(fileList[i]);
    }
  }

  function bindDragUpload() {
    if (!uploadSection) return;
    uploadSection.addEventListener('dragover', function (e) {
      e.preventDefault();
      uploadSection.classList.add('drag-over');
    });
    uploadSection.addEventListener('dragleave', function () {
      uploadSection.classList.remove('drag-over');
    });
    uploadSection.addEventListener('drop', function (e) {
      e.preventDefault();
      uploadSection.classList.remove('drag-over');
      var transfer = e.dataTransfer;
      if (!transfer || !transfer.files || transfer.files.length === 0) return;
      addFileFromList(transfer.files);
    });
  }

  /**
   * 从剪贴板读取图片并加入列表（粘贴事件用）
   */
  function addImageFromClipboard(items) {
    if (!items) return;
    var i;
    for (i = 0; i < items.length; i++) {
      var item = items[i];
      if (item.type && item.type.indexOf('image') !== -1) {
        var blob = item.getAsFile();
        if (!blob) continue;
        var reader = new FileReader();
        reader.onload = function (e) {
          var dataUrl = e.target.result;
          if (typeof dataUrl === 'string') {
            images.push(dataUrl);
            saveContent();
            renderImages();
            showToast('已粘贴图片');
          }
        };
        reader.readAsDataURL(blob);
        return; /* 一次只处理一张 */
      }
    }
  }

  function copyToClipboard() {
    if (!textEl) return;
    var value = textEl.value;
    if (typeof navigator.clipboard !== 'undefined' && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(function () {
        showToast('已复制到剪贴板');
      }).catch(function () {
        fallbackCopy(value);
      });
    } else {
      fallbackCopy(value);
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast('已复制到剪贴板');
    } catch (e) {
      showToast('复制失败，请手动选择复制');
    }
    document.body.removeChild(ta);
  }

  function clearAll() {
    if (textEl) textEl.value = '';
    images = [];
    files = [];
    saveContent();
    renderImages();
    renderFiles();
    showToast('已清空');
  }

  if (textEl) {
    textEl.addEventListener('input', scheduleSave);
    textEl.addEventListener('paste', function (e) {
      var items = e.clipboardData && e.clipboardData.items;
      if (items && items.length > 0) {
        addImageFromClipboard(items);
        /* 若粘贴的是图片，可阻止默认行为，避免把 data URL 当文字贴进输入框 */
        var hasImage = false;
        for (var j = 0; j < items.length; j++) {
          if (items[j].type && items[j].type.indexOf('image') !== -1) {
            hasImage = true;
            break;
          }
        }
        if (hasImage) e.preventDefault();
      }
    });
  }
  if (copyBtn) copyBtn.addEventListener('click', copyToClipboard);
  if (clearBtn) clearBtn.addEventListener('click', clearAll);
  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', function () {
      fileInput.click();
    });
    fileInput.addEventListener('change', function () {
      addFileFromList(fileInput.files);
      fileInput.value = '';
    });
  }
  bindDragUpload();

  loadHostUrl();
  loadContent();
  setInterval(syncContentFromServer, POLL_INTERVAL_MS);

  /* 无图片时先隐藏图片区域 */
  if (imagesSection) imagesSection.style.display = 'none';
  if (filesSection) filesSection.style.display = 'none';
})();
