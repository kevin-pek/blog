---
title: How to Create Windows Bootable USB on Mac
description: 
publishDate: 2024-04-05
updatedDate: 
tags:
---
## Requirements

Make sure you have [homebrew](https://brew.sh/) installed, and a USB drive that is large enough to contain the Windows image. I used an 8GB thumbdrive for this. Make sure that any files in your USB are backed up somewhere else if you need them. See the website you downloaded the ISO from for more details.

Now insert the USB drive and run the following command on the terminal to find which disk identifier MacOS assigned to the USB driver:

```sh
diskutil list external
```

Adding the `external` word only displays mounted volumes, which helps to find your USB drive easily. In my case, the identifier `disk4` was assigned to my USB drive.

## Erase the USB Drive

We will erase the USB drive using the MS-DOS format, with the Master Boot Record (MBR) scheme. This is needed to find the necessary files when trying to install Windows. I put the name of the drive is "WINDOWS11" and the identifier is disk4.

```sh
diskutil eraseDisk MS-DOS "WINDOWS11" MBR disk4
```

## Mount Windows ISO

Next we need to mount the windows ISO. To do this you can either:

- Double click the ISO in Finder.
- Run `hdiutil mount Win11_23H2_English_x64v2.iso`, assuming the ISO file is in your currrent directory.

## Copying Files over to USB

First we will copy over all files in the ISO file that we just mounted **except** for install.wim. We can do this using the following command:

```sh
rsync -avh --progress --exclude=sources/install.wim /Volumes/CCCOMA_X64FRE_EN-US_DV9/ /Volumes/WINDOWS11
```

### Splitting install.wim

The reason we excluded install.wim from the files copied over is because the MS-DOS (FAT32) format has a file size limit of 4096MB. Since install.wim is larger than this limit, we need to split the file into smaller parts. To do this we can use `wimlib`, which we can install using homebrew:

```sh
brew install wimlib
```

We can then split install.wim and copy it into our USB drive using the following command:

```sh
wimlib-imagex split /Volumes/CCCOMA_X64FRE_EN-US_DV9/sources/install.wim /Volumes/WINDOWS11/sources/install.swm 4000
```

`4000` limits the size of each split to 4000MB, which is a little below the limit.

Once this command is done running, we can unmount the drive either through the eject button on Finder or using the command `diskutil unmount /dev/disk4`. We can then use this USB to boot windows.

So after all that, turns out my machine didn't meet the system requirements for running windows 11, so I had to repeat this process to install windows 10. Hopefully you don't face the same issue I did!
