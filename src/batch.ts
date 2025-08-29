import { Modal, TFile, App, Setting } from 'obsidian';

import {
  path, createElementTree, debugLog, lockInputMethodComposition,
} from './utils';

interface State {
	namePattern: string
	extPattern: string
	nameReplace: string
	renameTasks: RenameTask[]
}

interface RenameTask {
	file: TFile
	name: string
}

type renameFuncType = (file: TFile, name: string) => Promise<void>

export class ImageBatchRenameModal extends Modal {
	activeFile: TFile
	renameFunc: renameFuncType
	onCloseExtra: () => void
	state: State

	constructor(app: App, activeFile: TFile, renameFunc: renameFuncType, onClose: () => void) {
		super(app);
		this.activeFile = activeFile
		this.renameFunc = renameFunc
		this.onCloseExtra = onClose

		this.state = {
			namePattern: '',
			extPattern: '',
			nameReplace: '',
			renameTasks: [],
		}
	}

	onOpen() {
		this.containerEl.addClass('image-rename-modal')
		const { contentEl, titleEl } = this;
		titleEl.setText('Batch rename embeded files')

		const namePatternSetting = new Setting(contentEl)
			.setName('Name pattern')
			.setDesc('Please input the name pattern to match files (regex)')
			.addText(text => text
				.setValue(this.state.namePattern)
				.onChange(async (value) => {
					this.state.namePattern = value
				}
				))
		const npInputEl = namePatternSetting.controlEl.children[0] as HTMLInputElement
		npInputEl.focus()
		const npInputState = lockInputMethodComposition(npInputEl)
		npInputEl.addEventListener('keydown', async (e) => {
			if (e.key === 'Enter' && !npInputState.lock) {
				e.preventDefault()
				if (!this.state.namePattern) {
					errorEl.innerText = 'Error: "Name pattern" could not be empty'
					errorEl.style.display = 'block'
					return
				}
				this.matchImageNames(tbodyEl)
			}
		})

		const extPatternSetting = new Setting(contentEl)
			.setName('Extension pattern')
			.setDesc('Please input the extension pattern to match files (regex)')
			.addText(text => text
				.setValue(this.state.extPattern)
				.onChange(async (value) => {
					this.state.extPattern = value
				}
				))
		const extInputEl = extPatternSetting.controlEl.children[0] as HTMLInputElement
		extInputEl.addEventListener('keydown', async (e) => {
			if (e.key === 'Enter') {
				e.preventDefault()
				this.matchImageNames(tbodyEl)
			}
		})

		const nameReplaceSetting = new Setting(contentEl)
			.setName('Name replace')
			.setDesc('Please input the string to replace the matched name (use $1, $2 for regex groups)')
			.addText(text => text
				.setValue(this.state.nameReplace)
				.onChange(async (value) => {
					this.state.nameReplace = value
				}
				))

		const nrInputEl = nameReplaceSetting.controlEl.children[0] as HTMLInputElement
		const nrInputState = lockInputMethodComposition(nrInputEl)
		nrInputEl.addEventListener('keydown', async (e) => {
			if (e.key === 'Enter' && !nrInputState.lock) {
				e.preventDefault()
				this.matchImageNames(tbodyEl)
			}
		})


		const matchedContainer = contentEl.createDiv({
			cls: 'matched-container',
		})
		const tableET = createElementTree(matchedContainer, {
			tag: 'table',
			children: [
				{
					tag: 'thead',
					children: [
						{
							tag: 'tr',
							children: [
								{
									tag: 'td',
									text: 'Original path',
								},
								{
									tag: 'td',
									text: 'Renamed Name',
								}
							]
						}
					]
				},
				{
					tag: 'tbody',
				}
			]
		})
		const tbodyEl = tableET.children[1].el

		const errorEl = contentEl.createDiv({
			cls: 'error',
			attr: {
				style: 'display: none;',
			}
		})

		new Setting(contentEl)
			.addButton(button => {
				button
					.setButtonText('Rename all')
					.setClass('mod-cta')
					.onClick(() => {
						new ConfirmModal(
							this.app,
							'Confirm rename all',
							`Are you sure? This will rename all the ${this.state.renameTasks.length} images matched the pattern.`,
							() => {
								this.renameAll()
								this.close()
							}
						).open()
					})
			})
			.addButton(button => {
				button
					.setButtonText('Cancel')
					.onClick(() => { this.close() })
			})
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		this.onCloseExtra()
	}

	async renameAll() {
		debugLog('renameAll', this.state)
		for (const task of this.state.renameTasks) {
			await this.renameFunc(task.file, task.name)
		}
	}

	matchImageNames(tbodyEl: HTMLElement) {
		const { state } = this
		const renameTasks: RenameTask[] = []
		tbodyEl.empty()
		const fileCache = this.app.metadataCache.getFileCache(this.activeFile)
		if (!fileCache || !fileCache.embeds) return

		const namePatternRegex = new RegExp(state.namePattern, 'g')
		const extPatternRegex = new RegExp(state.extPattern)
		fileCache.embeds.forEach(embed => {
			const file = this.app.metadataCache.getFirstLinkpathDest(embed.link, this.activeFile.path)
			if (!file) {
				console.warn('file not found', embed.link)
				return
			}
			// match ext (only if extPattern is not empty)
			if (state.extPattern) {
				const m0 = extPatternRegex.exec(file.extension)
				if (!m0) return
			}

			// match stem
			const stem = file.basename
			namePatternRegex.lastIndex = 0
			const m1 = namePatternRegex.exec(stem)
			if (!m1) return

			let renamedName = file.name
			if (state.nameReplace) {
				namePatternRegex.lastIndex = 0
				renamedName = stem.replace(namePatternRegex, state.nameReplace)
				renamedName = `${renamedName}.${file.extension}`
			}
			renameTasks.push({
				file,
				name: renamedName,
			})

			createElementTree(tbodyEl, {
				tag: 'tr',
				children: [
					{
						tag: 'td',
						children: [
							{
								tag: 'span',
								text: file.name,
							},
							{
								tag: 'div',
								text: file.path,
								attr: {
									class: 'file-path',
								}
							}
						]
					},
					{
						tag: 'td',
						children: [
							{
								tag: 'span',
								text: renamedName,
							},
							{
								tag: 'div',
								text: path.join(file.parent.path, renamedName),
								attr: {
									class: 'file-path',
								}
							}
						]
					}
				]

			})
		})

		debugLog('new renameTasks', renameTasks)
		state.renameTasks = renameTasks
	}
}


interface ConversionState {
	namePattern: string
	extPattern: string
	targetFormat: string
	conversionTasks: ConversionTask[]
}

interface ConversionTask {
	file: TFile
	targetFormat: string
}

type conversionFuncType = (file: TFile, targetFormat: string) => Promise<void>

export class ImageBatchConversionModal extends Modal {
	activeFile: TFile
	conversionFunc: conversionFuncType
	onCloseExtra: () => void
	plugin: any
	state: ConversionState

	constructor(app: App, activeFile: TFile, conversionFunc: conversionFuncType, onClose: () => void, plugin: any) {
		super(app);
		this.activeFile = activeFile
		this.conversionFunc = conversionFunc
		this.onCloseExtra = onClose
		this.plugin = plugin

		this.state = {
			namePattern: '',
			extPattern: '',
			targetFormat: 'webp',
			conversionTasks: [],
		}
	}

	onOpen() {
		this.containerEl.addClass('image-rename-modal')
		const { contentEl, titleEl } = this;
		titleEl.setText('Batch convert image formats')

		const namePatternSetting = new Setting(contentEl)
			.setName('Name pattern')
			.setDesc('Please input the name pattern to match files (regex)')
			.addText(text => text
				.setValue(this.state.namePattern)
				.onChange(async (value) => {
					this.state.namePattern = value
				}
				))
		const npInputEl = namePatternSetting.controlEl.children[0] as HTMLInputElement
		npInputEl.focus()
		const npInputState = lockInputMethodComposition(npInputEl)
		npInputEl.addEventListener('keydown', async (e) => {
			if (e.key === 'Enter' && !npInputState.lock) {
				e.preventDefault()
				if (!this.state.namePattern) {
					errorEl.innerText = 'Error: "Name pattern" could not be empty'
					errorEl.style.display = 'block'
					return
				}
				this.matchImageNames(tbodyEl)
			}
		})

		const extPatternSetting = new Setting(contentEl)
			.setName('Extension pattern')
			.setDesc('Please input the extension pattern to match files (regex)')
			.addText(text => text
				.setValue(this.state.extPattern)
				.onChange(async (value) => {
					this.state.extPattern = value
				}
				))
		const extInputEl = extPatternSetting.controlEl.children[0] as HTMLInputElement
		extInputEl.addEventListener('keydown', async (e) => {
			if (e.key === 'Enter') {
				e.preventDefault()
				this.matchImageNames(tbodyEl)
			}
		})

		const formatSetting = new Setting(contentEl)
			.setName('Target format')
			.setDesc('Choose the format to convert images to')
			.addDropdown(dropdown => {
				dropdown
					.addOption('jpg', 'JPG')
					.addOption('webp', 'WebP')
					.addOption('png', 'PNG')
				
				// Add AVIF option only if supported
				if (this.plugin.supportsAvif()) {
					dropdown.addOption('avif', 'AVIF')
				}
				
				dropdown
					.setValue(this.state.targetFormat)
					.onChange(async (value) => {
						this.state.targetFormat = value
						this.matchImageNames(tbodyEl)
					})
			})

		const matchedContainer = contentEl.createDiv({
			cls: 'matched-container',
		})
		const tableET = createElementTree(matchedContainer, {
			tag: 'table',
			children: [
				{
					tag: 'thead',
					children: [
						{
							tag: 'tr',
							children: [
								{
									tag: 'td',
									text: 'Original path',
								},
								{
									tag: 'td',
									text: 'Target Format',
								}
							]
						}
					]
				},
				{
					tag: 'tbody',
				}
			]
		})
		const tbodyEl = tableET.children[1].el

		const errorEl = contentEl.createDiv({
			cls: 'error',
			attr: {
				style: 'display: none;',
			}
		})

		new Setting(contentEl)
			.addButton(button => {
				button
					.setButtonText('Convert all')
					.setClass('mod-cta')
					.onClick(() => {
						new ConfirmModal(
							this.app,
							'Confirm convert all',
							`Are you sure? This will convert all the ${this.state.conversionTasks.length} images matched the pattern to ${this.state.targetFormat.toUpperCase()} format.`,
							() => {
								this.convertAll()
								this.close()
							}
						).open()
					})
			})
			.addButton(button => {
				button
					.setButtonText('Cancel')
					.onClick(() => { this.close() })
			})
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		this.onCloseExtra()
	}

	async convertAll() {
		debugLog('convertAll', this.state)
		for (const task of this.state.conversionTasks) {
			await this.conversionFunc(task.file, task.targetFormat)
		}
	}

	matchImageNames(tbodyEl: HTMLElement) {
		const { state } = this
		const conversionTasks: ConversionTask[] = []
		tbodyEl.empty()
		const fileCache = this.app.metadataCache.getFileCache(this.activeFile)
		if (!fileCache || !fileCache.embeds) return

		const namePatternRegex = new RegExp(state.namePattern, 'g')
		const extPatternRegex = new RegExp(state.extPattern)
		const imageExtensionRegex = /jpe?g|png|gif|tiff|webp|avif/i
		
		fileCache.embeds.forEach(embed => {
			const file = this.app.metadataCache.getFirstLinkpathDest(embed.link, this.activeFile.path)
			if (!file) {
				console.warn('file not found', embed.link)
				return
			}
			
			// Only process image files
			if (!imageExtensionRegex.test(file.extension)) {
				return
			}

			// match ext (only if extPattern is not empty)
			if (state.extPattern) {
				const m0 = extPatternRegex.exec(file.extension)
				if (!m0) return
			}

			// match stem
			const stem = file.basename
			namePatternRegex.lastIndex = 0
			const m1 = namePatternRegex.exec(stem)
			if (!m1) return

			// Skip if already in target format
			if (file.extension.toLowerCase() === state.targetFormat.toLowerCase()) {
				debugLog('Skipping file already in target format:', file.name)
				return
			}

			conversionTasks.push({
				file,
				targetFormat: state.targetFormat,
			})

			createElementTree(tbodyEl, {
				tag: 'tr',
				children: [
					{
						tag: 'td',
						children: [
							{
								tag: 'span',
								text: file.name,
							},
							{
								tag: 'div',
								text: file.path,
								attr: {
									class: 'file-path',
								}
							}
						]
					},
					{
						tag: 'td',
						children: [
							{
								tag: 'span',
								text: state.targetFormat.toUpperCase(),
							},
							{
								tag: 'div',
								text: `${file.basename}.${state.targetFormat}`,
								attr: {
									class: 'file-path',
								}
							}
						]
					}
				]

			})
		})

		debugLog('new conversionTasks', conversionTasks)
		state.conversionTasks = conversionTasks
	}
}

class ConfirmModal extends Modal {
	title: string
	message: string
	onConfirm: () => void

	constructor(app: App, title: string, message: string, onConfirm: () => void) {
		super(app);
		this.title = title
		this.message = message
		this.onConfirm = onConfirm
	}

	onOpen(): void {
		const { contentEl, titleEl } = this;
		titleEl.setText(this.title)
		contentEl.createEl('p', {
			text: this.message,
		})

		new Setting(contentEl)
			.addButton(button => {
				button
					.setButtonText('Yes')
					.setClass('mod-warning')
					.onClick(() => {
						this.onConfirm()
						this.close()
					})
			})
			.addButton(button => {
				button
					.setButtonText('No')
					.onClick(() => { this.close() })
			})
	}
}
