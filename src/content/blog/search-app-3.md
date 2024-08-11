---
title: Making an app to search documents, Part 3
description: using SearchKit and improving performance with streams and multithreading
publishDate: 2024-08-11
updatedDate: 2024-08-11
tags:
  - search
  - nodejs
  - swift
---
While developing the initial version of the extension [PDFSearch](https://github.com/kevin-pek/pdfsearch) for Raycast at the start of this year, I experimented with a lot of different ideas. I tried implementing better semantic search by using embedding models, which involved converting PyTorch models from Huggingface into CoreML, and writing SQLite functions to store these embedding values. I originally planned to document this process in part 2 of this series, but ended up putting it off.

In the end, the most effective approach I found was also a straightforward one, which is just to use string matching in PDF documents, and implement query expansion using the Natural Language package if we are unable to find any search results. A lot of work ended up getting wasted, but that's just how it is when the best way forward is unknown.

The previous implementation works by creating a new process that runs precompiled Swift scripts that accept a set of command line arguments. These standalone scripts implement functions such as rendering pages of the PDF documents, and searching across a single document with a given query.

For example, if we want to search a collection, a new search process will be started for each PDF file in the collection with the user's search query as the argument, where each program's `stdout` is a list of JSON objects representing the search results. Upon completion, these results are then parsed by the NodeJS process (V8 Isolate) which the extension runs in.

However, Raycast actually provides a [Swift package](https://github.com/raycast/extensions-swift-tools) to make this process simpler, removing the need for me to compile my own Swift scripts and handle outputs. Instead of writing self contained scripts, I can now wrap the code inside functions marked with the `@raycast` macro, and they will be compiled into functions I can call directly within my extension. This still launches a new process for the Swift program under the hood, but the workflow is greatly simplified.

Aside from porting the extension to use Raycast's Swift tools, I also improved the search logic for the extension by constructing a TF-IDF based inverted index for each collection, which can then be used for faster similarity based searching.

## Search Kit

Chances are you have never heard of this package. Neither did I, when I was working on the initial implementation of this project. It was only a few months after I had first published my extension when I came across Search Kit on the apple developer documentation by chance.

[Search Kit](https://developer.apple.com/documentation/coreservices/search_kit) provides a C API that handles indexing and searching text, and can be accessed within the CoreServices package. It supports many types of searches we need such as phrase searches, prefix/suffix/substring searches, boolean searches, summarisation and relevance ranking. This provides much of the capability I need for my extension, and promises to significantly speed up its performance. There is also an [old version](https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/SearchKitConcepts/searchKit_intro/searchKit_intro.html#//apple_ref/doc/uid/TP40002842-TPXREF101) of the documentation that introduces basic concepts from information retrieval, and a more in-depth explanation of how Search Kit implements these ideas.

### Creating a new index

When creating a search index, we can either store it in memory using `SKIndexCreateWithMutableData` or if we wish to persist it, in a file using `SKIndexCreateWithURL`. In the case of my extension, saving the optimised index is the better option, since I want to avoid recreating the index unless changes are made to the collection.

Since an existing index can also be updated in my extension, I also had to consider the case where an index already exists. If so, the program will load the existing index and update it with the newer documents.

```swift
func createOrOpenIndex(_ collection: String, _ supportPath: String) -> SKIndex? {
    let supportDirectoryURL = URL(fileURLWithPath: supportPath)
    if !isDirectory(url: supportDirectoryURL) {
        return nil
    }
    let indexURL = supportDirectoryURL.appendingPathComponent("\(collection).index")
    if FileManager.default.fileExists(atPath: indexURL.path) {
        let unmanagedIndex = SKIndexOpenWithURL(indexURL as CFURL, collection as CFString, true)
        return unmanagedIndex?.takeRetainedValue()
    } else {
        let unmanagedIndex = SKIndexCreateWithURL(indexURL as CFURL, collection as CFString, kSKIndexInvertedVector, nil)
        return unmanagedIndex?.takeRetainedValue()
    }
}
```

### Adding documents to our index

To extract the text information from our documents, Search Kit provides built-in plugins to deal with some common document types. We can load this within our program using the function provided.

```swift
SKLoadDefaultExtractorPlugIns()
```

We can then create a document, which in this context, is an arbitrary unit of text that we can define ourselves based on our use case. In this context, a single document is represented as a single page of a PDF document. We can then add or update the documents to an index using the method `SKIndexAddDocumentWithText`.

```swift
guard let pdfDocument = PDFDocument(url: documentURL) else {
	throw IndexError.failedToAddDocument("Failed to load pdf docuemnt.")
}

for i in 0..<pdfDocument.pageCount {
	if let page = pdfDocument.page(at: i), let text = page.string {
		let documentURL = URL(fileURLWithPath: "\(documentURL.path)_\(i)")
		let documentRef = SKDocumentCreateWithURL(documentURL as CFURL).takeRetainedValue()
		SKIndexAddDocumentWithText(index, documentRef, text as CFString, true)
	}
}
```

Something to note is when documents are added to the index as shown above, the index is in fact, not updated with the latest changes. A new search process on the index will not include the latest document updates unless we use either `SKIndexFlush` or `SKIndexCompact` to commit the changes, which take in the index as the only argument.

Both methods return a boolean indicating whether the operation was successful. The difference between them is that `SKIndexCompact` also compacts the index, which is useful when the index's disk or memory footprint increases due to fragmentation.

```swift
guard SKIndexCompact(index) else {
	throw IndexError.compactFailed("Error occurred while compacting index.")
}
```

### Searching the index

Once we have created an index, we can start a search process using `SKSearchCreate`, then iterate over the search results using `SKSearchFindMatches`, which returns a boolean value indicating whether there are more search results to be found.

We can specify the type of search we want using `SKSearchOptions`, which by default is treated as a boolean query. In my case, I want the query to search for similarity using TF-IDF scoring, so it is set to `kSKSearchOptionFindSimilar`.

```swift
let options = SKSearchOptions(kSKSearchOptionFindSimilar) // find resutls based on similarity
let search = SKSearchCreate(index, query as CFString, options).takeRetainedValue()
```

When iterating over the search results using `SKSearchFindMatches`, we also specify the number of results to search for, represented by `k`, the `maximumTime` which indicates the number of seconds before the function returns, and pass in pointers to arrays to write documentIDs, scores and the number of documents found.

```swift
let k = 20
var returnDocuments = [Document]()
var documentIDs = UnsafeMutablePointer<SKDocumentID>.allocate(capacity: k)
var scores = UnsafeMutablePointer<Float>.allocate(capacity: k)
var numResults: CFIndex = 0
var hasMore = true
repeat {
	hasMore = SKSearchFindMatches(search, k, documentIDs, scores, 1, &numResults)
	if numResults > 0 {
		for i in 0..<numResults {
			// handle up search results within documentIDs and scores
			// ...
		}
	}
} while hasMore && numResults > 0
```

We can then handle the search results in whichever manner we wish. For example, since I want to return the path of the document that is retrieved, I use `SKIndexCopyDocumentURLsForDocumentIDs` to retrieve the document URLs from the list of document IDs.

```swift
var documentURLs = UnsafeMutablePointer<Unmanaged<CFURL>?>.allocate(capacity: numResults)
SKIndexCopyDocumentURLsForDocumentIDs(index, numResults, documentIDs, documentURLs)
for i in 0..<numResults {
	let unmanagedURL = documentURLs[i]
	let url = unmanagedURL.takeRetainedValue() as URL
	// update list of search results
	// ...
}
```

## Optimisations

In addition to introducing SearchKit to replace the previous search logic, I also made some optimisations to improve the responsiveness of the extension.

### Caching search result images

The first optimisation is a quality of life improvement, which is to cache the image renders of PDF pages when displaying search results. Previously, search results for PDF pages are rendered as an image and saved to the `tmp` directory using PDFKit. The image is then displayed when the user hovers over the search result. This results in a noticeable delay before the page is visible every time a different search result is viewed.

To avoid unnecessary rendering of PDF pages that have already been rendered, we can add a key-value cache to map a document's file path and page number to the path to its image. Lucky for us, the [Raycast API](https://developers.raycast.com/api-reference/cache) provides an out of the box Cache class, and so this optimisation was easily implemented.

```typescript
// src/utils.ts
const cache = new Cache();

// src/type.d.ts
export type Document = {
  id: number;
  file: string;
  score: number;
  page: number;
  lower: number | undefined;
  upper: number | undefined;
};

// src/views/search.tsx
import fs from "fs";
import path from "path";
import { List } from "@raycast/api";
import { showFailureToast, usePromise } from "@raycast/utils";

function SearchResultDetail({ document }: { document: Document }) {
  const { data: markdown, isLoading } = usePromise(async () => {
    try {
      if (path.extname(document.file) === ".pdf") {
        const key = `${document.file}_${document.page}`;
        const tmpPath = cache.get(key);
        // if file still exists in temp directory render it straightaway
        if (tmpPath && fs.existsSync(tmpPath)) {
          return `![Page Preview](${tmpPath})`;
        } else {
          const newPath = await drawImage(document.file, document.page, document.lower, document.upper);
          cache.set(key, newPath);
          return `![Page Preview](${newPath})`;
        }
      } else {
        const buffer = fs.readFileSync(document.file);
        return buffer.toString();
      }
    } catch (err) {
      showFailureToast(`Error occurred when drawing page: ${err}`);
    }
  });

  return <List.Item.Detail isLoading={isLoading} markdown={markdown} />;
}
```

### Speeding up collection indexing

When creating a new collection with a larger number of documents, or PDFs with a few hundred pages, it takes quite a while to index the document. This is because the current implementation of the indexing process is single threaded.

A relatively straightforward way we can improve the performance of the indexing process is to use multithreading. By indexing the documents in the global `DispatchQueue`, the code is executed concurrently, and the program can run in parallel on multiple CPU cores. This reduces the time taken for the indexing process for each page in the PDF document to \<1s.

To avoid race conditions when adding documents to the index, I used a mutex to define a critical section corresponding to the function call `SKIndexAddDocumentWithText`. This ensures that only one thread can execute this function at a time, preventing concurrent modifications to the index.

```swift
// load or create index
let queue = DispatchQueue.global(qos: .userInitiated)
let group = DispatchGroup()
SKLoadDefaultExtractorPlugIns()
let lock = NSRecursiveLock() // allows a single thread to acquire the lock multiple times
for filepath in filepaths {
	// handling edge cases, get pdfDocument and documentURL
	// ...
	for i in 0..<pdfDocument.pageCount {
		group.enter()
		queue.async {
			defer { group.leave() }
			if let page = pdfDocument.page(at: i), let text = page.string {
				let documentURL = URL(fileURLWithPath: "\(documentURL.path)_\(i)")
				let documentRef = SKDocumentCreateWithURL(documentURL as CFURL).takeRetainedValue()
				lock.lock()
				defer { lock.unlock() }
				SKIndexAddDocumentWithText(index, documentRef, text as CFString, true)
			}
		}
	}
}
group.wait()
// compact the index
```

### Speeding up the search process

The last and most significant optimisation pertains to the search process. With the single threaded implementation, searching larger collections can take a few minutes to run, since there can be a few hundred search results. Using multithreading similar to the previous section sped up the search process, though searches can still take a full minute to run. This is because the main bottleneck of the process comes from the while loop calling `SKSearchFindMatches`, which to my knowledge cannot be effectively parallelised.

Additionally, when the user edits the search query in the extension, old search processes does not get cleaned up. This can easily lead to have 4-5 ongoing search processes at once, further slowing down the search process.

#### Streaming search results

To improve the responsiveness of the search process, I modified the search logic to stream results back to the extension every time a batch of results have been retrieved. This makes it so that the user waits for at most a second before search results are displayed.

To do this, we can use a file to pipe the search results to the NodeJS process the extension runs in. Every time a batch of search results have been retrieved, they will also be written to the pipe as a JSON string. The NodeJS process the extension runs then parses the JSON string and updates the state with the new results.

To implement this, I used the `ReadStream` from the NodeJS API to parse the string results in chunks. This is encapsulated in the function `createReader` as shown below, which creates a stream that updates the search results whenever more data is written to the file.

```typescript
const readStreamPath = "/tmp/search_results.jsonl";

export default function SearchCollection(props: { collectionName: string }) {
  // ...
  const readStreamRef = useRef<fs.ReadStream | undefined>();
  const createReader = () => {
    if (readStreamRef.current) {
      readStreamRef.current.close();
    }
    const readStream = fs.createReadStream(readStreamPath, { encoding: "utf8" });
    readStreamRef.current = readStream;
    let buffer = "";

    readStream.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // keep the last incomplete line in the buffer if parsing fails
      const searchResults = [];
      for (const i in lines) {
        try {
          searchResults.push(JSON.parse(lines[i]) as Document);
        } catch {
          continue;
        }
      }
      setResults(searchResults);
    });
  };
  // ...
```

Within the Swift code for the search process, I also had to change the code to write to the pipe instead.

```swift
let readStreamPath = "/tmp/search_results.jsonl"
let fileHandle: FileHandle
if FileManager.default.fileExists(atPath: readStreamPath) {
	fileHandle = try FileHandle(forWritingTo: URL(fileURLWithPath: readStreamPath))
	fileHandle.seekToEndOfFile()
} else {
	throw SearchError.missingFile("Missing file to write results.")
}

repeat {
	// search logic
	// ...
	// write the current batch of results to file
	for doc in returnDocuments {
		if let jsonData = try? JSONEncoder().encode(doc) {
			fileHandle.write(jsonData)
			fileHandle.write("\n".data(using: .utf8)!)
		}
	}
} while hasMore && numResults > 0
```

Now we get a much more responsive search process, where search results are continually updated with more results every second, until all matches have been retrieved!

#### File based inter-process communication

To tackle the second problem, we can use files to serve as signals and a mutex, to terminate any existing search processes before starting a new one. Since the implementation does not expose process information such as the search process id, I was unable to use the NodeJS API to directly terminate existing search processes. To overcome this issue, I implemented this using file based IPC instead.

To do this, a lock file is created whenever a search is started, which we can use to check whether a search process is running. This search process watches for another file which acts as a signal to terminate the existing search process.

```swift
let lockFilePath = "/tmp/search_process.lock"
let sigtermFilePath = "/tmp/search_process.terminate"

FileManager.default.createFile(atPath: lockFilePath, contents: nil, attributes: nil)

// Ensure files are removed when the process terminates
defer {
	try? FileManager.default.removeItem(atPath: lockFilePath)
	fileHandle.closeFile()
}

// ...

repeat {
	// Check for termination signal
	if FileManager.default.fileExists(atPath: sigtermFilePath) {
		try? FileManager.default.removeItem(atPath: sigtermFilePath)
		break
	}
	// rest of search logic
	// ...
} while hasMore && numResults > 0
```

We also have to change the logic for launching a new search process whenever the user query changes. Before starting a new process, we check if the lock file is present, and create the file to signal to the existing process to terminate. To avoid synchronisation issues, we check if the process is terminated at a regular interval.

```typescript
const sigtermFilePath = "/tmp/search_process.terminate";
const lockFilePath = "/tmp/search_process.lock";

const searchOnLockFileFree = () => {
  // if lock file exists, send signal to terminate ongoing search process
  if (fs.existsSync(lockFilePath)) {
	fs.writeFileSync(sigtermFilePath, "");
	setTimeout(() => {
	  searchOnLockFileFree();
	}, 200); // wait for half a second to allow existing process to cleanup
  } else {
	handleSearch();
  }
};
```

Once the lock file has been removed, we know that the old search process has ended. We then run our search function as per usual. Putting everything together in a `useEffect` hook gives us the following implementation.

```typescript
export default function SearchCollection(props: { collectionName: string }) {
  // other logic
  // ...
  // search and update results for the search query everytime the query changes
  useEffect(() => {
    const handleSearch = async () => {
      if (!query || !collection) {
        setResults([]);
        return;
      }

      try {
        setIsSearching(true);
        fs.writeFileSync(readStreamPath, "", "utf8"); // reset file where results are written to
        // We do not need to call createReader() here since writing to file triggers it.
        await searchCollection(query, collection.name, environment.supportPath);
      } catch (err) {
        showFailureToast(err);
      } finally {
        if (fs.existsSync(lockFilePath)) {
          fs.unlinkSync(lockFilePath); // remove lock file after search is completed
        }
        setIsSearching(false);
      }
    };

    const searchOnLockFileFree = () => {
      // if lock file exists, send signal to terminate ongoing search process
      if (fs.existsSync(lockFilePath)) {
        fs.writeFileSync(sigtermFilePath, "");
        setTimeout(() => {
          searchOnLockFileFree();
        }, 200); // wait for half a second to allow existing process to cleanup
      } else {
        handleSearch();
      }
    };

    searchOnLockFileFree();
  }, [query, collection]);
  // ...
}
```

## The end

This pretty much sums up the changes made when building the second version of my PDFSearch extension. Things got surprisingly complicated at times, but it was a good exercise overall, and I learnt quite a bit about Swift and NodeJS.

If you are interested in using or improving this extension, you can find the Github repo [here](https://github.com/kevin-pek/pdfsearch). Suggestions or feature requests are also welcome!
