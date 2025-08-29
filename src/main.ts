/* TODOs:
 * - [x] check name existence when saving
 * - [x] imageNameKey in frontmatter
 * - [x] after renaming, cursor should be placed after the image file link
 * - [x] handle image insert from drag'n drop
 * - [ ] select text when opening the renaming modal, make this an option
 * - [ ] add button for use the current file name, imageNameKey, last input name,
 *       segments of last input name
 * - [x] batch rename all pasted images in a file
 * - [ ] add rules for moving matched images to destination folder
 */
import {
  App,
  HeadingCache,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TAbstractFile,
  TFile,
} from 'obsidian';

import { ImageBatchRenameModal, ImageBatchConversionModal } from './batch';
import { renderTemplate } from './template';
import {
  createElementTree,
  DEBUG,
  debugLog,
  escapeRegExp,
  lockInputMethodComposition,
  NameObj,
  path,
  sanitizer,
} from './utils';

interface PluginSettings {
	// {{imageNameKey}}-{{DATE:YYYYMMDD}}
	imageNamePattern: string
	dupNumberAtStart: boolean
	dupNumberDelimiter: string
	dupNumberAlways: boolean
	autoRename: boolean
	handleAllAttachments: boolean
	excludeExtensionPattern: string
	disableRenameNotice: boolean
	// Compression settings
	enableCompression: boolean
	maxWidth: number
	maxHeight: number
	jpgQuality: number
	webpQuality: number
	avifQuality: number
	outputFormat: string
	smartFormatSelection: boolean
}

const DEFAULT_SETTINGS: PluginSettings = {
	imageNamePattern: '{{fileName}}',
	dupNumberAtStart: false,
	dupNumberDelimiter: '-',
	dupNumberAlways: false,
	autoRename: false,
	handleAllAttachments: false,
	excludeExtensionPattern: '',
	disableRenameNotice: false,
	// Compression defaults
	enableCompression: true,
	maxWidth: 1920,
	maxHeight: 1080,
	jpgQuality: 0.85,
	webpQuality: 0.8,
	avifQuality: 0.7,
	outputFormat: 'auto',
	smartFormatSelection: true,
}

const PASTED_IMAGE_PREFIX = 'Pasted image '


export default class PasteImageRenamePlugin extends Plugin {
	settings: PluginSettings
	modals: Modal[] = []
	excludeExtensionRegex: RegExp
	isProcessingCompression = false

	async onload() {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const pkg = require('../package.json')
		console.log(`Plugin loading: ${pkg.name} ${pkg.version} BUILD_ENV=${process.env.BUILD_ENV}`)
		await this.loadSettings();

		this.registerEvent(
			this.app.vault.on('create', (file) => {
				// debugLog('file created', file)
				if (!(file instanceof TFile))
					return
				const timeGapMs = (new Date().getTime()) - file.stat.ctime
				// if the file is created more than 1 second ago, the event is most likely be fired on vault initialization when starting Obsidian app, ignore it
				if (timeGapMs > 1000)
					return
				// always ignore markdown file creation
				if (isMarkdownFile(file))
					return
				
				// CRITICAL FIX: Ignore files created by our compression process
				if (this.isProcessingCompression) {
					debugLog('ignoring file created by compression process', file.path)
					return
				}
				
				if (isPastedImage(file)) {
					debugLog('pasted image created', file)
					this.startRenameProcess(file, this.settings.autoRename)
				} else {
					if (this.settings.handleAllAttachments) {
						debugLog('handleAllAttachments for file', file)
						if (this.testExcludeExtension(file)) {
							debugLog('excluded file by ext', file)
							return
						}
						this.startRenameProcess(file, this.settings.autoRename)
					}
				}
			})
		)

		const startBatchRenameProcess = () => {
			this.openBatchRenameModal()
		}
		this.addCommand({
			id: 'batch-rename-embeded-files',
			name: 'Batch rename embeded files (in the current file)',
			callback: startBatchRenameProcess,
		})
		if (DEBUG) {
			this.addRibbonIcon('wand-glyph', 'Batch rename embeded files', startBatchRenameProcess)
		}

		const batchRenameAllImages = () => {
			this.batchRenameAllImages()
		}
		this.addCommand({
			id: 'batch-rename-all-images',
			name: 'Batch rename all images instantly (in the current file)',
			callback: batchRenameAllImages,
		})
		if (DEBUG) {
			this.addRibbonIcon('wand-glyph', 'Batch rename all images instantly (in the current file)', batchRenameAllImages)
		}

		// Add batch conversion commands
		const startBatchConversionProcess = () => {
			this.openBatchConversionModal()
		}
		this.addCommand({
			id: 'batch-convert-images',
			name: 'Batch convert image formats (in the current file)',
			callback: startBatchConversionProcess,
		})
		if (DEBUG) {
			this.addRibbonIcon('compress-glyph', 'Batch convert image formats', startBatchConversionProcess)
		}

		const batchConvertAllImages = () => {
			this.batchConvertAllImages()
		}
		this.addCommand({
			id: 'batch-convert-all-images',
			name: 'Batch convert all images to optimal format (in the current file)',
			callback: batchConvertAllImages,
		})
		if (DEBUG) {
			this.addRibbonIcon('compress-glyph', 'Batch convert all images to optimal format', batchConvertAllImages)
		}

		// add settings tab
		this.addSettingTab(new SettingTab(this.app, this));

	}

	async startRenameProcess(file: TFile, autoRename = false) {
		// get active file first
		const activeFile = this.getActiveFile()
		if (!activeFile) {
			new Notice('Error: No active file found.')
			return
		}

		const { stem, newName, isMeaningful }= this.generateNewName(file, activeFile)
		debugLog('generated newName:', newName, isMeaningful)

		if (!isMeaningful || !autoRename) {
			this.openRenameModal(file, isMeaningful ? stem : '', activeFile.path)
			return
		}
		this.renameFile(file, newName, activeFile.path, true)
	}

	async renameFile(file: TFile, inputNewName: string, sourcePath: string, replaceCurrentLine?: boolean) {
		// deduplicate name
		const { name:newName } = await this.deduplicateNewName(inputNewName, file)
		debugLog('deduplicated newName:', newName)
		const originName = file.name

		// generate linkText using Obsidian API, linkText is either  ![](filename.png) or ![[filename.png]] according to the "Use [[Wikilinks]]" setting.
		const linkText = this.app.fileManager.generateMarkdownLink(file, sourcePath)

		// file system operation: rename the file
		const newPath = path.join(file.parent.path, newName)
		try {
			await this.app.fileManager.renameFile(file, newPath)
		} catch (err) {
			new Notice(`Failed to rename ${newName}: ${err}`)
			throw err
		}

		if (!replaceCurrentLine) {
			return
		}

		// in case fileManager.renameFile may not update the internal link in the active file,
		// we manually replace the current line by manipulating the editor

		const newLinkText = this.app.fileManager.generateMarkdownLink(file, sourcePath)
		debugLog('replace text', linkText, newLinkText)

		const editor = this.getActiveEditor()
		if (!editor) {
			new Notice(`Failed to rename ${newName}: no active editor`)
			return
		}

		const cursor = editor.getCursor()
		const line = editor.getLine(cursor.line)
		const replacedLine = line.replace(linkText, newLinkText)
		debugLog('current line -> replaced line', line, replacedLine)
		// console.log('editor context', cursor, )
		editor.transaction({
			changes: [
				{
					from: {...cursor, ch: 0},
					to: {...cursor, ch: line.length},
					text: replacedLine,
				}
			]
		})

		if (!this.settings.disableRenameNotice) {
			new Notice(`Renamed ${originName} to ${newName}`)
		}
	}

	openRenameModal(file: TFile, newName: string, sourcePath: string) {
		const modal = new ImageRenameModal(
			this.app, file as TFile, newName,
			async (confirmedName: string, selectedFormat?: string) => {
				debugLog('confirmedName:', confirmedName, 'selectedFormat:', selectedFormat)
				
				if (selectedFormat && selectedFormat !== file.extension) {
					// Compress with format conversion - handle link replacement manually
					try {
						// Generate link text BEFORE compression using original file
						const originalLinkText = this.app.fileManager.generateMarkdownLink(file, sourcePath);
						debugLog('Original link text before compression:', originalLinkText);
						
						const compressedFile = await this.compressToFormat(file, selectedFormat);
						if (compressedFile) {
							// Update the file name to match the new format
							const nameWithNewExt = confirmedName.replace(/\.[^.]+$/, '') + '.' + selectedFormat;
							
							// Rename the compressed file (without link replacement first)
							const { name: finalName } = await this.deduplicateNewName(nameWithNewExt, compressedFile);
							const finalPath = path.join(compressedFile.parent.path, finalName);
							debugLog('Renaming compressed file', { 
								compressedPath: compressedFile.path, 
								finalPath, 
								finalName 
							});
							
							await this.app.fileManager.renameFile(compressedFile, finalPath);
							
							// Get the final file reference
							const finalFile = this.app.vault.getAbstractFileByPath(finalPath) as TFile;
							debugLog('Final file reference', { 
								finalFilePath: finalFile?.path,
								exists: !!finalFile 
							});
							
							// Now manually replace the link using the original link text and new file
							const newLinkText = this.app.fileManager.generateMarkdownLink(finalFile, sourcePath);
							debugLog('New link text after compression and rename:', newLinkText);
							
							// Manually replace the link in the editor
							const editor = this.getActiveEditor();
							if (editor) {
								const cursor = editor.getCursor();
								const line = editor.getLine(cursor.line);
								const replacedLine = line.replace(originalLinkText, newLinkText);
								debugLog('Link replacement:', { originalLinkText, newLinkText, line, replacedLine });
								
								editor.transaction({
									changes: [{
										from: {...cursor, ch: 0},
										to: {...cursor, ch: line.length},
										text: replacedLine,
									}]
								});
							}
							
							if (!this.settings.disableRenameNotice) {
								new Notice(`Converted ${file.name} to ${finalName}`);
							}
						} else {
							throw new Error('Compression failed');
						}
					} catch (error) {
						console.error('Format conversion failed:', error);
						new Notice(`Format conversion failed: ${error.message}`);
						// Fall back to normal rename
						await this.renameFile(file, confirmedName, sourcePath, true);
					}
				} else {
					// Normal rename without format change
					await this.renameFile(file, confirmedName, sourcePath, true);
				}
			},
			() => {
				this.modals.splice(this.modals.indexOf(modal), 1)
			},
			this
		)
		this.modals.push(modal)
		modal.open()
		debugLog('modals count', this.modals.length)
	}

	openBatchRenameModal() {
		const activeFile = this.getActiveFile()
		const modal = new ImageBatchRenameModal(
			this.app,
			activeFile,
			async (file: TFile, name: string) => {
				await this.renameFile(file, name, activeFile.path)
			},
			() => {
				this.modals.splice(this.modals.indexOf(modal), 1)
			}
		)
		this.modals.push(modal)
		modal.open()
	}

	openBatchConversionModal() {
		const activeFile = this.getActiveFile()
		const modal = new ImageBatchConversionModal(
			this.app,
			activeFile,
			async (file: TFile, targetFormat: string) => {
				debugLog('Converting file:', file.path, 'to format:', targetFormat)
				
				// Capture original link text BEFORE compression
				const originalLinkText = this.app.fileManager.generateMarkdownLink(file, activeFile.path)
				
				const compressedFile = await this.compressToFormat(file, targetFormat)
				if (compressedFile) {
					// Generate a proper name for the converted file
					const { newName } = this.generateNewName(compressedFile, activeFile)
					// Deduplicate and rename the file
					const { stem, extension } = await this.deduplicateNewName(newName, compressedFile)
					const finalName = stem + '.' + extension
					
					// Rename the compressed file
					const finalPath = compressedFile.parent.path + '/' + finalName
					const renamedFile = await this.app.fileManager.renameFile(compressedFile, finalPath)
					
					// Get fresh reference to the final file
					const finalFile = this.app.vault.getAbstractFileByPath(finalPath) as TFile
					if (finalFile) {
						// Generate new link text for the final file
						const newLinkText = this.app.fileManager.generateMarkdownLink(finalFile, activeFile.path)
						
						// Update ALL occurrences of the link in the editor
						const editor = this.getActiveEditor()
						if (editor && originalLinkText !== newLinkText) {
							this.replaceAllLinksInEditor(editor, originalLinkText, newLinkText)
							debugLog('Updated all links in batch conversion:', originalLinkText, '→', newLinkText)
						}
					}
					
					new Notice(`Successfully converted and renamed: ${file.name} → ${finalName}`)
				} else {
					new Notice(`Failed to convert: ${file.name}`)
				}
			},
			() => {
				this.modals.splice(this.modals.indexOf(modal), 1)
			},
			this
		)
		this.modals.push(modal)
		modal.open()
	}

	async batchConvertAllImages() {
		const activeFile = this.getActiveFile()
		const fileCache = this.app.metadataCache.getFileCache(activeFile)
		if (!fileCache || !fileCache.embeds) return
		const extPatternRegex = /jpe?g|png|gif|tiff|webp|avif/i

		let convertedCount = 0
		for (const embed of fileCache.embeds) {
			const file = this.app.metadataCache.getFirstLinkpathDest(embed.link, activeFile.path)
			if (!file) {
				console.warn('file not found', embed.link)
				continue
			}
			// match ext
			const m0 = extPatternRegex.exec(file.extension)
			if (!m0) continue

			// Determine optimal format
			const optimalFormat = this.getOptimalDefaultFormat(file.extension)
			
			// Skip if already in optimal format
			if (file.extension.toLowerCase() === optimalFormat.toLowerCase()) {
				debugLog('Skipping file already in optimal format:', file.name)
				continue
			}

			debugLog('Converting file to optimal format:', file.name, '→', optimalFormat)
			
			// Capture original link text BEFORE compression
			const originalLinkText = this.app.fileManager.generateMarkdownLink(file, activeFile.path)
			
			const compressedFile = await this.compressToFormat(file, optimalFormat)
			if (compressedFile) {
				// Generate a proper name for the converted file
				const { newName } = this.generateNewName(compressedFile, activeFile)
				// Deduplicate and rename the file
				const { stem, extension } = await this.deduplicateNewName(newName, compressedFile)
				const finalName = stem + '.' + extension
				
				// Rename the compressed file
				const finalPath = compressedFile.parent.path + '/' + finalName
				const renamedFile = await this.app.fileManager.renameFile(compressedFile, finalPath)
				
				// Get fresh reference to the final file
				const finalFile = this.app.vault.getAbstractFileByPath(finalPath) as TFile
				if (finalFile) {
					// Generate new link text for the final file
					const newLinkText = this.app.fileManager.generateMarkdownLink(finalFile, activeFile.path)
					
					// Update ALL occurrences of the link in the editor
					const editor = this.getActiveEditor()
					if (editor && originalLinkText !== newLinkText) {
						this.replaceAllLinksInEditor(editor, originalLinkText, newLinkText)
						debugLog('Updated all links in batch conversion:', originalLinkText, '→', newLinkText)
					}
				}
				
				convertedCount++
			}
		}
		
		new Notice(`Batch conversion complete: ${convertedCount} images converted to optimal format`)
	}

	async batchRenameAllImages() {
		const activeFile = this.getActiveFile()
		const fileCache = this.app.metadataCache.getFileCache(activeFile)
		if (!fileCache || !fileCache.embeds) return
		const extPatternRegex = /jpe?g|png|gif|tiff|webp/i

		for (const embed of fileCache.embeds) {
			const file = this.app.metadataCache.getFirstLinkpathDest(embed.link, activeFile.path)
			if (!file) {
				console.warn('file not found', embed.link)
				return
			}
			// match ext
			const m0 = extPatternRegex.exec(file.extension)
			if (!m0) return

			// rename
			const { newName, isMeaningful }= this.generateNewName(file, activeFile)
			debugLog('generated newName:', newName, isMeaningful)
			if (!isMeaningful) {
				new Notice('Failed to batch rename images: the generated name is not meaningful')
				break;
			}

			await this.renameFile(file, newName, activeFile.path, false)
		}
	}

	// returns a new name for the input file, with extension
	generateNewName(file: TFile, activeFile: TFile) {
		let imageNameKey = ''
		let firstHeading = ''
		let frontmatter
		const fileCache = this.app.metadataCache.getFileCache(activeFile)
		if (fileCache) {
			debugLog('frontmatter', fileCache.frontmatter)
			frontmatter = fileCache.frontmatter
			imageNameKey = frontmatter?.imageNameKey || ''
			firstHeading = getFirstHeading(fileCache.headings)
		} else {
			console.warn('could not get file cache from active file', activeFile.name)
		}

		const stem = renderTemplate(
			this.settings.imageNamePattern,
			{
				imageNameKey,
				fileName: activeFile.basename,
				dirName: activeFile.parent.name,
				firstHeading,
			},
			frontmatter)
		const meaninglessRegex = new RegExp(`[${this.settings.dupNumberDelimiter}\\s]`, 'gm')

		return {
			stem,
			newName: stem + '.' + file.extension,
			isMeaningful: stem.replace(meaninglessRegex, '') !== '',
		}
	}

	// newName: foo.ext
	async deduplicateNewName(newName: string, file: TFile): Promise<NameObj> {
		// list files in dir
		const dir = file.parent.path
		const listed = await this.app.vault.adapter.list(dir)
		debugLog('sibling files', listed)

		// parse newName
		const newNameExt = path.extension(newName),
			newNameStem = newName.slice(0, newName.length - newNameExt.length - 1),
			newNameStemEscaped = escapeRegExp(newNameStem),
			delimiter = this.settings.dupNumberDelimiter,
			delimiterEscaped = escapeRegExp(delimiter)

		let dupNameRegex
		if (this.settings.dupNumberAtStart) {
			dupNameRegex = new RegExp(
				`^(?<number>\\d+)${delimiterEscaped}(?<name>${newNameStemEscaped})\\.${newNameExt}$`)
		} else {
			dupNameRegex = new RegExp(
				`^(?<name>${newNameStemEscaped})${delimiterEscaped}(?<number>\\d+)\\.${newNameExt}$`)
		}
		debugLog('dupNameRegex', dupNameRegex)

		const dupNameNumbers: number[] = []
		let isNewNameExist = false
		for (let sibling of listed.files) {
			sibling = path.basename(sibling)
			if (sibling == newName) {
				isNewNameExist = true
				continue
			}

			// match dupNames
			const m = dupNameRegex.exec(sibling)
			if (!m) continue
			// parse int for m.groups.number
			dupNameNumbers.push(parseInt(m.groups.number))
		}

		if (isNewNameExist || this.settings.dupNumberAlways) {
			// get max number
			const newNumber = dupNameNumbers.length > 0 ? Math.max(...dupNameNumbers) + 1 : 1
			// change newName
			if (this.settings.dupNumberAtStart) {
				newName = `${newNumber}${delimiter}${newNameStem}.${newNameExt}`
			} else {
				newName = `${newNameStem}${delimiter}${newNumber}.${newNameExt}`
			}
		}

		return {
			name: newName,
			stem: newName.slice(0, newName.length - newNameExt.length - 1),
			extension: newNameExt,
		}
	}

	getActiveFile() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView)
		const file = view?.file
		debugLog('active file', file?.path)
		return file
	}
	getActiveEditor() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView)
		return view?.editor
	}

	replaceAllLinksInEditor(editor: any, originalLinkText: string, newLinkText: string) {
		if (!editor || originalLinkText === newLinkText) return
		
		const content = editor.getValue()
		
		// Use a more robust approach to handle different link formats
		// Create regex patterns to match various link formats
		const escapedOriginal = originalLinkText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
		
		// Try multiple replacement strategies:
		
		// 1. Exact match replacement (most common)
		let updatedContent = content.replace(new RegExp(escapedOriginal, 'g'), newLinkText)
		
		// 2. Handle cases where the link might be encoded differently
		if (originalLinkText.includes('%20')) {
			const unescapedOriginal = originalLinkText.replace(/%20/g, ' ')
			const escapedUnescaped = unescapedOriginal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
			updatedContent = updatedContent.replace(new RegExp(escapedUnescaped, 'g'), newLinkText)
		}
		
		// 3. Handle cases where spaces might be encoded as %20 in one but not the other
		if (originalLinkText.includes(' ')) {
			const encodedOriginal = originalLinkText.replace(/ /g, '%20')
			const escapedEncoded = encodedOriginal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
			updatedContent = updatedContent.replace(new RegExp(escapedEncoded, 'g'), newLinkText)
		}
		
		// Apply the changes if content was modified
		if (content !== updatedContent) {
			editor.setValue(updatedContent)
			debugLog('Replaced all occurrences:', { originalLinkText, newLinkText, changes: content.length - updatedContent.length })
		} else {
			debugLog('No replacements made for:', originalLinkText)
		}
	}

	onunload() {
		this.modals.map(modal => modal.close())
	}

	testExcludeExtension(file: TFile): boolean {
		const pattern = this.settings.excludeExtensionPattern
		if (!pattern) return false
		return new RegExp(pattern).test(file.extension)
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// Compression utility methods
	async compressToFormat(file: TFile, targetFormat: string): Promise<TFile | null> {
		try {
			// Set flag to prevent file creation event from triggering
			this.isProcessingCompression = true;
			
			const arrayBuffer = await this.app.vault.readBinary(file);
			const blob = new Blob([arrayBuffer]);
			
			const compressedBlob = await this.compressBlob(blob, targetFormat);
			if (!compressedBlob) {
				return null;
			}

			// Create new file with compressed data and new extension
			const newExtension = this.getExtensionFromFormat(targetFormat);
			const newPath = file.path.replace(/\.[^.]+$/, '.' + newExtension);
			
			debugLog('Compression: creating new file', { 
				originalPath: file.path, 
				newPath, 
				targetFormat, 
				newExtension 
			});
			
			// Delete original and create compressed version
			await this.app.vault.delete(file);
			const compressedBuffer = await compressedBlob.arrayBuffer();
			const newFile = await this.app.vault.createBinary(newPath, compressedBuffer);
			
			debugLog('Compression: new file created', { newFilePath: newFile.path });
			
			// Clear the flag after file system operations complete
			// Use a more robust approach with immediate flag clearing after successful creation
			this.isProcessingCompression = false;
			
			return newFile;
		} catch (error) {
			console.error('Format conversion failed:', error);
			// Make sure to clear flag even on error
			this.isProcessingCompression = false;
			return null;
		}
	}

	async compressBlob(blob: Blob, targetFormat: string): Promise<Blob | null> {
		return new Promise((resolve) => {
			const canvas = document.createElement('canvas');
			const ctx = canvas.getContext('2d');
			const img = new Image();

			img.onload = () => {
				// Calculate new dimensions maintaining aspect ratio
				const { width, height } = this.calculateDimensions(img.width, img.height);
				
				canvas.width = width;
				canvas.height = height;
				
				// Draw and compress
				ctx?.drawImage(img, 0, 0, width, height);
				
				const quality = this.getQualityForFormat(targetFormat);
				const mimeType = this.getMimeType(targetFormat);
				
				canvas.toBlob(resolve, mimeType, quality);
			};

			img.onerror = () => resolve(null);
			img.src = URL.createObjectURL(blob);
		});
	}

	calculateDimensions(originalWidth: number, originalHeight: number): { width: number, height: number } {
		const maxWidth = this.settings.maxWidth;
		const maxHeight = this.settings.maxHeight;
		
		if (originalWidth <= maxWidth && originalHeight <= maxHeight) {
			return { width: originalWidth, height: originalHeight };
		}
		
		const widthRatio = maxWidth / originalWidth;
		const heightRatio = maxHeight / originalHeight;
		const ratio = Math.min(widthRatio, heightRatio);
		
		return {
			width: Math.round(originalWidth * ratio),
			height: Math.round(originalHeight * ratio)
		};
	}

	getQualityForFormat(format: string): number {
		switch (format) {
			case 'jpg': return this.settings.jpgQuality;
			case 'webp': return this.settings.webpQuality;
			case 'avif': return this.settings.avifQuality;
			default: return 0.85;
		}
	}

	getMimeType(format: string): string {
		switch (format) {
			case 'jpg': return 'image/jpeg';
			case 'webp': return 'image/webp';
			case 'avif': return 'image/avif';
			case 'png': return 'image/png';
			default: return 'image/jpeg';
		}
	}

	getExtensionFromFormat(format: string): string {
		switch (format) {
			case 'jpg': return 'jpg';
			case 'webp': return 'webp';
			case 'avif': return 'avif';
			case 'png': return 'png';
			default: return 'jpg';
		}
	}

	getOptimalDefaultFormat(originalExtension: string): string {
		// If compression is disabled, always keep original
		if (!this.settings.enableCompression) {
			return originalExtension;
		}

		// If output format is set to something specific, use that
		if (this.settings.outputFormat !== 'auto') {
			return this.settings.outputFormat;
		}

		// If auto mode and smart format selection is enabled
		if (this.settings.smartFormatSelection) {
			// Smart format selection logic
			if (this.supportsAvif() && originalExtension !== 'gif') {
				return 'avif';
			} else if (this.supportsWebp()) {
				return 'webp';
			} else {
				return 'jpg';
			}
		}

		// Default fallback
		return 'webp';
	}

	supportsAvif(): boolean {
		const canvas = document.createElement('canvas');
		canvas.width = 1;
		canvas.height = 1;
		return canvas.toDataURL('image/avif', 0.5).indexOf('data:image/avif') === 0;
	}

	supportsWebp(): boolean {
		const canvas = document.createElement('canvas');
		canvas.width = 1;
		canvas.height = 1;
		return canvas.toDataURL('image/webp', 0.5).indexOf('data:image/webp') === 0;
	}
}

function getFirstHeading(headings?: HeadingCache[]) {
	if (headings && headings.length > 0) {
		for (const heading of headings) {
			if (heading.level === 1) {
				return heading.heading
			}
		}
	}
	return ''
}

function isPastedImage(file: TAbstractFile): boolean {
	if (file instanceof TFile) {
		if (file.name.startsWith(PASTED_IMAGE_PREFIX)) {
			return true
		}
	}
	return false
}

function isMarkdownFile(file: TAbstractFile): boolean {
	if (file instanceof TFile) {
		if (file.extension === 'md') {
			return true
		}
	}
	return false
}

const IMAGE_EXTS = [
	'jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg',
]

function isImage(file: TAbstractFile): boolean {
	if (file instanceof TFile) {
		if (IMAGE_EXTS.contains(file.extension.toLowerCase())) {
			return true
		}
	}
	return false
}

class ImageRenameModal extends Modal {
	src: TFile
	stem: string
	renameFunc: (path: string, selectedFormat?: string) => void
	onCloseExtra: () => void
	plugin: PasteImageRenamePlugin

	constructor(app: App, src: TFile, stem: string, renameFunc: (path: string, selectedFormat?: string) => void, onClose: () => void, plugin: PasteImageRenamePlugin) {
		super(app);
		this.src = src
		this.stem = stem
		this.renameFunc = renameFunc
		this.onCloseExtra = onClose
		this.plugin = plugin
	}

	onOpen() {
		this.containerEl.addClass('image-rename-modal')
		const { contentEl, titleEl } = this;
		titleEl.setText('Rename image')

		const imageContainer = contentEl.createDiv({
			cls: 'image-container',
		})
		imageContainer.createEl('img', {
			attr: {
				src: this.app.vault.getResourcePath(this.src),
			}
		})

		let stem = this.stem
		const ext = this.src.extension
		const getNewName = (stem: string) => stem + '.' + ext
		const getNewPath = (stem: string) => path.join(this.src.parent.path, getNewName(stem))

		const infoET = createElementTree(contentEl, {
			tag: 'ul',
			cls: 'info',
			children: [
				{
					tag: 'li',
					children: [
						{
							tag: 'span',
							text: 'Origin path',
						},
						{
							tag: 'span',
							text: this.src.path,
						}
					],
				},
				{
					tag: 'li',
					children: [
						{
							tag: 'span',
							text: 'New path',
						},
						{
							tag: 'span',
							text: getNewPath(stem),
						}
					],
				}
			]
		})

		// Add format selection if compression is enabled
		const defaultFormat = this.plugin.getOptimalDefaultFormat(ext);
		let selectedFormat = defaultFormat; // Use settings-based default
		
		debugLog('Modal format selection:', {
			originalExtension: ext,
			defaultFormat,
			outputFormatSetting: this.plugin.settings.outputFormat,
			compressionEnabled: this.plugin.settings.enableCompression,
			smartFormatSelection: this.plugin.settings.smartFormatSelection
		});
		
		if (this.plugin.settings.enableCompression) {
			const formatSetting = new Setting(contentEl)
				.setName('Output format')
				.setDesc('Choose the output format for the image')
				.addDropdown(dropdown => {
					dropdown
						.addOption(ext, `Keep original (${ext.toUpperCase()})`)
						.addOption('jpg', 'JPG (smaller, lossy)')
						.addOption('webp', 'WebP (modern, good compression)')
						.addOption('avif', 'AVIF (best compression)')
						.setValue(defaultFormat) // Set to optimal default from settings
						.onChange(value => {
							selectedFormat = value;
							// Update the new path display
							const newName = stem + '.' + selectedFormat;
							const newPath = path.join(this.src.parent.path, newName);
							infoET.children[1].children[1].el.innerText = newPath;
						});
				});

			// Update the initial path display to show default format
			if (defaultFormat !== ext) {
				const initialName = stem + '.' + defaultFormat;
				const initialPath = path.join(this.src.parent.path, initialName);
				infoET.children[1].children[1].el.innerText = initialPath;
			}

			// Add compression info
			const compressionInfo = contentEl.createDiv({
				cls: 'compression-info',
				text: 'Compression settings can be adjusted in plugin settings'
			});
			compressionInfo.style.fontSize = '0.8em';
			compressionInfo.style.color = 'var(--text-muted)';
			compressionInfo.style.marginBottom = '10px';
		}

		const doRename = async () => {
			debugLog('doRename', `stem=${stem}, format=${selectedFormat}`)
			// Construct the final name with correct extension
			const finalName = stem + '.' + (selectedFormat || ext);
			this.renameFunc(finalName, selectedFormat !== ext ? selectedFormat : undefined)
		}

		const nameSetting = new Setting(contentEl)
			.setName('New name')
			.setDesc('Please input the new name for the image (without extension)')
			.addText(text => text
				.setValue(stem)
				.onChange(async (value) => {
					stem = sanitizer.filename(value)
					infoET.children[1].children[1].el.innerText = getNewPath(stem)
				}
				))

		const nameInputEl = nameSetting.controlEl.children[0] as HTMLInputElement
		const nameInputState = lockInputMethodComposition(nameInputEl)
		nameInputEl.addEventListener('keydown', async (e) => {
			// console.log('keydown', e.key, `lock=${nameInputState.lock}`)
			if (e.key === 'Enter' && !nameInputState.lock) {
				e.preventDefault()
				if (!stem) {
					errorEl.innerText = 'Error: "New name" could not be empty'
					errorEl.style.display = 'block'
					return
				}
				doRename()
				this.close()
			}
		})

		const errorEl = contentEl.createDiv({
			cls: 'error',
			attr: {
				style: 'display: none;',
			}
		})

		new Setting(contentEl)
			.addButton(button => {
				button
					.setButtonText('Rename')
					.onClick(() => {
						doRename()
						this.close()
					})
			})
			.addButton(button => {
				button
					.setButtonText('Cancel')
					.onClick(() => { this.close() })
			})

		// Set focus to name input at the very end to ensure it's not stolen by other elements
		setTimeout(() => {
			nameInputEl.focus()
			nameInputEl.select() // Also select all text for quick replacement
		}, 0)
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		this.onCloseExtra()
	}
}

const imageNamePatternDesc = `
The pattern indicates how the new name should be generated.

Available variables:
- {{fileName}}: name of the active file, without ".md" extension.
- {{dirName}}: name of the directory which contains the document (the root directory of vault results in an empty variable).
- {{imageNameKey}}: this variable is read from the markdown file's frontmatter, from the same key "imageNameKey".
- {{DATE:$FORMAT}}: use "$FORMAT" to format the current date, "$FORMAT" must be a Moment.js format string, e.g. {{DATE:YYYY-MM-DD}}.

Here are some examples from pattern to image names (repeat in sequence), variables: fileName = "My note", imageNameKey = "foo":
- {{fileName}}: My note, My note-1, My note-2
- {{imageNameKey}}: foo, foo-1, foo-2
- {{imageNameKey}}-{{DATE:YYYYMMDD}}: foo-20220408, foo-20220408-1, foo-20220408-2
`

class SettingTab extends PluginSettingTab {
	plugin: PasteImageRenamePlugin;

	constructor(app: App, plugin: PasteImageRenamePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Image name pattern')
			.setDesc(imageNamePatternDesc)
			.setClass('long-description-setting-item')
			.addText(text => text
				.setPlaceholder('{{imageNameKey}}')
				.setValue(this.plugin.settings.imageNamePattern)
				.onChange(async (value) => {
					this.plugin.settings.imageNamePattern = value;
					await this.plugin.saveSettings();
				}
			));

		new Setting(containerEl)
			.setName('Duplicate number at start (or end)')
			.setDesc(`If enabled, duplicate number will be added at the start as prefix for the image name, otherwise it will be added at the end as suffix for the image name.`)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.dupNumberAtStart)
				.onChange(async (value) => {
					this.plugin.settings.dupNumberAtStart = value
					await this.plugin.saveSettings()
				}
				))

		new Setting(containerEl)
			.setName('Duplicate number delimiter')
			.setDesc(`The delimiter to generate the number prefix/suffix for duplicated names. For example, if the value is "-", the suffix will be like "-1", "-2", "-3", and the prefix will be like "1-", "2-", "3-". Only characters that are valid in file names are allowed.`)
			.addText(text => text
				.setValue(this.plugin.settings.dupNumberDelimiter)
				.onChange(async (value) => {
					this.plugin.settings.dupNumberDelimiter = sanitizer.delimiter(value);
					await this.plugin.saveSettings();
				}
			));

		new Setting(containerEl)
			.setName('Always add duplicate number')
			.setDesc(`If enabled, duplicate number will always be added to the image name. Otherwise, it will only be added when the name is duplicated.`)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.dupNumberAlways)
				.onChange(async (value) => {
					this.plugin.settings.dupNumberAlways = value
					await this.plugin.saveSettings()
				}
				))

		new Setting(containerEl)
			.setName('Auto rename')
			.setDesc(`By default, the rename modal will always be shown to confirm before renaming, if this option is set, the image will be auto renamed after pasting.`)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoRename)
				.onChange(async (value) => {
					this.plugin.settings.autoRename = value;
					await this.plugin.saveSettings();
				}
			));

		new Setting(containerEl)
			.setName('Handle all attachments')
			.setDesc(`By default, the plugin only handles images that starts with "Pasted image " in name,
			which is the prefix Obsidian uses to create images from pasted content.
			If this option is set, the plugin will handle all attachments that are created in the vault.`)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.handleAllAttachments)
				.onChange(async (value) => {
					this.plugin.settings.handleAllAttachments = value;
					await this.plugin.saveSettings();
				}
			));

		new Setting(containerEl)
			.setName('Exclude extension pattern')
			.setDesc(`This option is only useful when "Handle all attachments" is enabled.
			Write a Regex pattern to exclude certain extensions from being handled. Only the first line will be used.`)
			.setClass('single-line-textarea')
			.addTextArea(text => text
				.setPlaceholder('docx?|xlsx?|pptx?|zip|rar')
				.setValue(this.plugin.settings.excludeExtensionPattern)
				.onChange(async (value) => {
					this.plugin.settings.excludeExtensionPattern = value;
					await this.plugin.saveSettings();
				}
			));

		new Setting(containerEl)
			.setName('Disable rename notice')
			.setDesc(`Turn off this option if you don't want to see the notice when renaming images.
			Note that Obsidian may display a notice when a link has changed, this option cannot disable that.`)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.disableRenameNotice)
				.onChange(async (value) => {
					this.plugin.settings.disableRenameNotice = value;
					await this.plugin.saveSettings();
				}
			));

		// Compression settings
		containerEl.createEl('h3', { text: 'Image Compression Settings' });

		new Setting(containerEl)
			.setName('Enable image compression')
			.setDesc('Enable compression and format conversion features in the rename modal')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableCompression)
				.onChange(async (value) => {
					this.plugin.settings.enableCompression = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Max width')
			.setDesc('Maximum width for compressed images (maintains aspect ratio)')
			.addText(text => text
				.setPlaceholder('1920')
				.setValue(this.plugin.settings.maxWidth.toString())
				.onChange(async (value) => {
					const width = parseInt(value);
					if (!isNaN(width) && width > 0) {
						this.plugin.settings.maxWidth = width;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Max height')
			.setDesc('Maximum height for compressed images (maintains aspect ratio)')
			.addText(text => text
				.setPlaceholder('1080')
				.setValue(this.plugin.settings.maxHeight.toString())
				.onChange(async (value) => {
					const height = parseInt(value);
					if (!isNaN(height) && height > 0) {
						this.plugin.settings.maxHeight = height;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('JPG quality')
			.setDesc('Quality for JPG compression (0.1 to 1.0)')
			.addSlider(slider => slider
				.setLimits(0.1, 1.0, 0.05)
				.setValue(this.plugin.settings.jpgQuality)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.jpgQuality = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('WebP quality')
			.setDesc('Quality for WebP compression (0.1 to 1.0)')
			.addSlider(slider => slider
				.setLimits(0.1, 1.0, 0.05)
				.setValue(this.plugin.settings.webpQuality)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.webpQuality = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('AVIF quality')
			.setDesc('Quality for AVIF compression (0.1 to 1.0)')
			.addSlider(slider => slider
				.setLimits(0.1, 1.0, 0.05)
				.setValue(this.plugin.settings.avifQuality)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.avifQuality = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Output format')
			.setDesc('Default output format for compression')
			.addDropdown(dropdown => dropdown
				.addOption('auto', 'Auto (smart selection)')
				.addOption('jpg', 'JPG')
				.addOption('webp', 'WebP')
				.addOption('avif', 'AVIF')
				.addOption('png', 'PNG (lossless)')
				.setValue(this.plugin.settings.outputFormat)
				.onChange(async (value) => {
					this.plugin.settings.outputFormat = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Smart format selection')
			.setDesc('Automatically choose the best format based on image content and browser support')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.smartFormatSelection)
				.onChange(async (value) => {
					this.plugin.settings.smartFormatSelection = value;
					await this.plugin.saveSettings();
				}));
	}
}
