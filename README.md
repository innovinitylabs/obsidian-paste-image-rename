# Obsidian paste image rename

> :loudspeaker: Starting from 1.4.0, Paste image rename becomes a general-purpose renaming plugin
> that can handle all attachments added to the vault.
>
> :new: **ENHANCED in 1.8.0**: Advanced image compression with AVIF, WebP, smart format selection, and batch compression!

This plugin is inspired by Zettlr, Zettlr shows a prompt that allows the user to rename the image, this is a great help if you want your images to be named and organized clearly.

<details>
  <summary>Zettlr's prompt after pasting an image</summary>

  ![image](https://user-images.githubusercontent.com/405972/162478462-b5ff4fc9-ade2-4ace-adcb-c6436479a7d9.png)
</details>

Paste image rename plugin not only implements Zettlr's feature, but also allows you to customize how the image name would be generated, and eventually free you from the hassle by automatically renaming the image according to the rules.

**Table of Contents**
- [Obsidian paste image rename](#obsidian-paste-image-rename)
  - [How to use](#how-to-use)
    - [Basic usage](#basic-usage)
    - [Set `imageNameKey` frontmatter](#set-imagenamekey-frontmatter)
    - [Add prefix/suffix to duplicated names](#add-prefixsuffix-to-duplicated-names)
    - [Batch renaming process](#batch-renaming-process)
    - [Batch rename all images instantly](#batch-rename-all-images-instantly)
    - [Handle all attachments](#handle-all-attachments)
    - [Image compression](#image-compression)
  - [FAQ](#faq)
  - [Settings](#settings)

## How to use

### Basic usage

After installing the plugin, you can just paste an image to any document and the rename prompt will display:
![](images/modal.png)

By typing the new name and clicking "Rename" (or just press enter), the image will be renamed and the internal link will be replaced with the new name.

If you set "Image name pattern" to `{{fileName}}` (it's the default behavior after 1.2.0),
"New name" will be generated as the name of the active file.
![](images/modal-fileName.png)

### Set `imageNameKey` frontmatter

While adding a lot of images to one document, people possibly want the images to be named in the same format, that's where `imageNameKey` is useful.

First set a value for `imageNameKey` in frontmatter:

```
---
imageNameKey: my-blog
---
```

Then paste an image, you will notice that the "New name" has already been generated as "my-blog", which is exactly the value of `imageNameKey`:
![](images/modal-with-imageNameKey.png)

You can change the pattern for new name generating by updating the "Image name pattern" value in settings.

For a detailed explanation and other features such as auto renaming, please refer to [Settings](#settings).


### Add prefix/suffix to duplicated names

The plugin will always try to add a prefix/suffix if there's a file of the same name.

Let's continue from the last section and paste the second image, the prompt will still show the new name as "my-blog", now if we just click "Rename", the file will be renamed as "my-blog-1.png", not "my-blog.png":

<img src="images/document.png" width="400px">

The `-1` suffix is generated according to the default settings:
- Because "Duplicate number at start" is false, suffix is used rather than prefix
- "Duplicate number delimiter" `-` is put before the number `1`

If we paste the third image without editing the "New name" input, its name will be "my-blog-2.png", the number is increased according to the largest number of "my-blog-?.png" in the attachment directory.

This feature is especially powerful if you enable "Auto rename" in settings, you can just add new images without thinking, and they will be renamed sequentially by the pattern and `imageNameKey` set.

### Batch renaming process

> New in 1.3.0

You can use the command "Batch rename embeded files in the current file"
to rename images and other attachments (even notes) in the current file.

![](images/batch-renaming.png)

The image above demonstrates how to rename all the `foo-1.png`, `foo-2.png`… png files
to `bar-1-png`, `bar-2.png`… with this feature.

You can also rename the images to the same name, and let the plugin handle
the name deduplication for you.  See a video demonstration here:
https://i.imgur.com/6UICugX.mp4


### Batch rename all images instantly

> New in 1.5.0

The command "Batch rename all images instantly (in the current file)" will
rename all the images in the current file according to
"Image name pattern" in settings.

This is a shortcut for using [Batch renaming process](#batch-renaming-process) with certain arguments,
makes everyday image renaming much easier.

Note that this command has no confirmation, please use it with caution!

### Handle all attachments

> New in 1.4.0

Paste image rename is not just a plugin for pasted images, it has the potential
to handle all attachments that are added to the vault, no matter whether they are pasted
or dragged.

To use this feature, you need to enable the "Handle all attachments" option in settings.

![](images/handle-all-attachments-settings.png)

Additionally, you can configure the "Exclude extension pattern" to ignore files
that match the given extension pattern.

### Image compression

> Enhanced in 1.8.0 with AVIF, WebP, smart format selection, and batch compression!

The plugin now includes advanced automatic image compression to dramatically reduce file sizes while maintaining quality. Perfect for high-resolution screenshots, photos, and keeping your Obsidian vault lightweight.

**Key features:**
- **Multiple format support**: PNG, JPG, WebP, and AVIF compression
- **Smart format selection**: Automatically chooses the best format based on image type and browser support
- **Resolution scaling**: Resize large images while maintaining aspect ratio
- **Batch compression**: Compress all existing images in your vault at once
- **Format-specific quality settings**: Fine-tune compression for each format
- **Browser compatibility**: Automatic fallback to supported formats
- **Size reporting**: Detailed feedback on compression savings

**How it works:**
1. When you paste an image, it's automatically analyzed and compressed using the optimal format
2. Large images are resized to your specified maximum dimensions
3. Smart format selection chooses AVIF for maximum compression, WebP for good compression, or JPG as fallback
4. Format conversion happens automatically with quality preservation
5. You'll see notifications showing compression results and space saved

**Example compression results:**
- Original: 2.5MB PNG screenshot
- AVIF: 150KB (94% size reduction!)
- WebP: 200KB (92% size reduction)
- JPG: 300KB (88% size reduction)

### Batch compression

> New in 1.8.0

Compress all existing images in your vault with a single command! Use the "Batch compress all images in vault" command to:

- Process hundreds of images automatically
- Apply your compression settings to the entire vault
- Get detailed progress reports and total space saved
- Maintain all existing file links and references

**Perfect for:**
- Migrating existing large image collections
- Optimizing vault size after adding many images
- Applying new compression settings to old images

### Advanced compression features

**Smart Format Selection:**
- **Screenshots/PNGs**: Prioritizes AVIF/WebP for maximum compression
- **Photos**: Uses AVIF for best quality-to-size ratio
- **Compression levels**: Low/Medium/High/Maximum presets

**Format Support:**
- **AVIF**: Best compression (up to 50% smaller than WebP), modern browsers only
- **WebP**: Excellent compression with wide browser support
- **JPG**: Reliable fallback with good compression
- **PNG**: Lossless option when quality is paramount

**Quality Controls:**
- Individual quality sliders for each format (1-100)
- Compression level presets for easy configuration
- Aspect ratio preservation during resizing


## FAQ

- Q: I pasted an image but the rename prompt did not show up.

    A: This is probably because you are using the Windows system and pasting from a file (i.e. the image is copied from File Explorer, not from a browser or image viewer). In Windows, pasting from a file is like a regular file transfer, the original filename is kept rather than being created and named "Pasted image ..." by Obsidian. You need to turn on "Handle all attachments" in settings to make it work in this situation.

- Q: Which image format should I choose for best compression?

    A: For maximum compression with modern browsers, use AVIF (up to 50% smaller than WebP). For wide compatibility, use WebP. For guaranteed support across all browsers, use JPG. Enable "Smart format selection" to automatically choose the best format for each image type.

- Q: My browser doesn't support AVIF/WebP. What happens?

    A: The plugin automatically detects browser capabilities and falls back to supported formats. You'll see a compatibility warning on startup, and compression will use the best available format.

- Q: Can I compress images I've already added to my vault?

    A: Yes! Use the "Batch compress all images in vault" command to compress all existing images according to your current settings. This is perfect for optimizing your vault after adding many images.

- Q: How much space can I save with compression?

    A: Typical savings: PNG screenshots can be reduced by 80-95% (2.5MB → 150KB with AVIF), photos by 70-90%, depending on quality settings and original image characteristics.

- Q: Will compression affect image quality noticeably?

    A: With proper quality settings (80-90%), compression is virtually indistinguishable for most note-taking purposes. You can always adjust quality sliders to find the perfect balance between size and quality.

## Settings

- **Image name pattern**

  The pattern indicates how the new name should be generated.

  - Available variables:
    - `{{fileName}}`: name of the active file, without ".md" extension.
    - `{{imageNameKey}}`: this variable is read from the markdown file's frontmatter, from the same key `imageNameKey`.
    - `{{DATE:$FORMAT}}`: use `$FORMAT` to format the current date, `$FORMAT` must be a Moment.js format string, e.g. `{{DATE:YYYY-MM-DD}}`.

  - Examples

    Here are some examples from pattern to image names (repeat in sequence), variables: `fileName = "My note", imageNameKey = "foo"`:
    - `{{fileName}}`: My note, My note-1, My note-2
    - `{{imageNameKey}}`: foo, foo-1, foo-2
    - `{{imageNameKey}}-{{DATE:YYYYMMDD}}`: foo-20220408, foo-20220408-1, foo-20220408-2
- **Duplicate number at start (or end)**

  If enabled, the duplicate number will be added at the start as prefix for the image name, otherwise, it will be added at the end as suffix for the image name.
- **Duplicate number delimiter**

  The delimiter to generate the number prefix/suffix for duplicated names. For example, if the value is `-`, the suffix will be like "-1", "-2", "-3", and the prefix will be like "1-", "2-", "3-".
- **Auto rename**

  By default, the rename modal will always be shown to confirm before renaming, if this option is set, the image will be auto renamed after pasting.
- **Handle all attachments**

  By default, the rename modal will always be shown to confirm before renaming, if this option is set, the image will be auto renamed after pasting.

- **Exclude extension pattern**

  This option is only useful when "Handle all attachments" is enabled.
	Write a Regex pattern to exclude certain extensions from being handled. Only the first line will be used.
- **Disable rename notice**

  Turn off this option if you don't want to see the notice when renaming images.
  Note that Obsidian may display a notice when a link has changed, this option cannot disable that.

#### Image Compression Settings

> Enhanced in 1.8.0

- **Enable compression**

  Automatically compress images to reduce file size when they are pasted or added to the vault.

- **Output format**

  Format to save compressed images as. AVIF provides best compression, WebP is widely supported, JPG is reliable fallback.

- **Compression level**

  Overall compression level: Low (fast), Medium (balanced), High (better compression), Maximum (best compression, may be slower).

- **Smart format selection**

  Automatically choose the best format based on image type and browser support. Recommended for optimal results.

- **JPG quality**

  Quality setting for JPG compression (1-100). Higher values = better quality but larger files.

- **WebP quality**

  Quality setting for WebP compression (1-100). Higher values = better quality but larger files.

- **AVIF quality**

  Quality setting for AVIF compression (1-100). Higher values = better quality but larger files.

- **Maximum width**

  Maximum width in pixels for resized images. Images larger than this will be scaled down proportionally.

- **Maximum height**

  Maximum height in pixels for resized images. Images larger than this will be scaled down proportionally.

#### New Commands

> New in 1.8.0

- **Batch compress all images in vault**

  Compress all existing images in your vault according to your compression settings. Perfect for optimizing existing image collections.
