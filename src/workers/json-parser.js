/**
 * Web Worker for non-blocking JSON parsing
 * Handles large JSON files without blocking the main thread
 */

/**
 * Parse JSON with progress tracking
 */
function parseJSONWithProgress(text) {
  try {
    // For very large files, we could implement streaming parsing
    // For now, we'll use standard JSON.parse with error handling
    const startTime = performance.now()
    const result = JSON.parse(text)
    const endTime = performance.now()
    
    return {
      questions: result,
      parseTime: endTime - startTime,
      size: text.length,
      questionsCount: Array.isArray(result) ? result.length : 0
    }
  } catch (error) {
    throw new Error(`JSON parsing failed: ${error.message}`)
  }
}

/**
 * Streaming JSON parser for very large files
 * This is a simplified implementation - for production, consider using a proper streaming parser
 */
function parseJSONStream(text) {
  const chunkSize = 1000000 // 1MB chunks
  const chunks = []
  
  // Split text into manageable chunks
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize))
  }
  
  return new Promise((resolve, reject) => {
    let jsonText = ''
    let processedChunks = 0
    
    const processChunk = () => {
      if (processedChunks < chunks.length) {
        jsonText += chunks[processedChunks]
        processedChunks++
        
        // Send progress update
        self.postMessage({
          type: 'progress',
          progress: (processedChunks / chunks.length) * 100,
          processedChunks,
          totalChunks: chunks.length
        })
        
        // Use setTimeout to yield control back to the event loop
        setTimeout(processChunk, 0)
      } else {
        // All chunks processed, now parse
        try {
          const result = JSON.parse(jsonText)
          resolve(result)
        } catch (error) {
          reject(error)
        }
      }
    }
    
    processChunk()
  })
}

/**
 * Validate question data structure
 */
function validateQuestions(questions) {
  if (!Array.isArray(questions)) {
    throw new Error('Questions data must be an array')
  }
  
  const requiredFields = ['id', 'question', 'options', 'answer']
  const errors = []
  
  questions.forEach((question, index) => {
    requiredFields.forEach(field => {
      if (!question[field]) {
        errors.push(`Question ${index}: Missing required field '${field}'`)
      }
    })
    
    // Validate options structure
    if (question.options && typeof question.options === 'object') {
      const optionKeys = Object.keys(question.options)
      if (optionKeys.length === 0) {
        errors.push(`Question ${index}: No options provided`)
      }
      
      // Check if answer exists in options
      if (question.answer && !optionKeys.includes(question.answer)) {
        errors.push(`Question ${index}: Answer '${question.answer}' not found in options`)
      }
    }
  })
  
  if (errors.length > 0) {
    throw new Error(`Validation errors:\n${errors.join('\n')}`)
  }
  
  return true
}

/**
 * Process questions data
 */
function processQuestions(questions) {
  return questions.map(question => ({
    ...question,
    // Add computed fields
    hasExplanation: Boolean(question.explanation),
    optionCount: question.options ? Object.keys(question.options).length : 0,
    subject: question.subject || 'Unknown',
    difficulty: question.difficulty || 'medium'
  }))
}

// Worker message handler
self.onmessage = async function(e) {
  const { text, streaming = false, validate = true } = e.data
  
  try {
    let questions
    
    if (streaming && text.length > 5000000) { // 5MB threshold for streaming
      // Use streaming parser for very large files
      self.postMessage({
        type: 'progress',
        progress: 0,
        message: 'Starting streaming parse...'
      })
      
      questions = await parseJSONStream(text)
    } else {
      // Use standard parsing
      const parseResult = parseJSONWithProgress(text)
      questions = parseResult.questions
      
      self.postMessage({
        type: 'progress',
        progress: 50,
        message: 'JSON parsed, processing...',
        parseTime: parseResult.parseTime
      })
    }
    
    // Validate questions if requested
    if (validate) {
      self.postMessage({
        type: 'progress',
        progress: 75,
        message: 'Validating questions...'
      })
      
      validateQuestions(questions)
    }
    
    // Process questions
    self.postMessage({
      type: 'progress',
      progress: 90,
      message: 'Processing questions...'
    })
    
    const processedQuestions = processQuestions(questions)
    
    // Send final result
    self.postMessage({
      type: 'complete',
      questions: processedQuestions,
      metadata: {
        count: processedQuestions.length,
        subjects: [...new Set(processedQuestions.map(q => q.subject))],
        size: text.length
      }
    })
    
  } catch (error) {
    self.postMessage({
      type: 'error',
      error: error.message,
      stack: error.stack
    })
  }
}

// Handle worker errors
self.onerror = function(error) {
  self.postMessage({
    type: 'error',
    error: error.message,
    filename: error.filename,
    lineno: error.lineno
  })
}