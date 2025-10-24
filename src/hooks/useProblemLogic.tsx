import type { ProblemState, Step } from '../types';
import { callOllamaModel } from '../connection';

export function useProblemLogic(
    setMode: (m: 'home' | 'problem' | 'quiz') => void,
    _appState: any
) {
    const generateSteps = async (
        userQuestion: string,
        setLoading?: (l: boolean) => void, // made optional
        setProblem?: (p: ProblemState) => void // made optional to be defensive
    ) => {
        const safeSetLoading = typeof setLoading === 'function' ? setLoading : () => {};
        const safeSetProblem = typeof setProblem === 'function' ? setProblem : () => {};

        safeSetLoading(true);
        try {
            const prompt = `You are a step-by-step problem solver. For the following question, break it down into clear, logical steps.

Question: ${userQuestion}

Respond EXACTLY in this format:
TOPIC: [what topic/subject this is]
STEP1: [First step instruction]
STEP1_ANSWER: [The correct answer/result for step 1]
STEP2: [Second step instruction]
STEP2_ANSWER: [The correct answer/result for step 2]
STEP3: [Third step instruction]
STEP3_ANSWER: [The correct answer/result for step 3]
STEP4: [Fourth step instruction (if needed)]
STEP4_ANSWER: [The correct answer/result for step 4 (if needed)]
STEP5: [Fifth step instruction (if needed)]
STEP5_ANSWER: [The correct answer/result for step 5 (if needed)]
FINAL_ANSWER: [The final answer to the original question]

Include 3-5 steps. Be specific about what the student should calculate or determine at each step. Only respond with this format, nothing else. Make sure you provide context from the question, for example if the question was converting between two different formats, provide the numbers that would be used in the conversion.`;

            const response = await callOllamaModel(prompt);
            console.log('Raw response:', response);

            const topicMatch = response.match(/TOPIC:\s*(.+?)(?=\n|$)/);
            const topic = topicMatch ? topicMatch[1].trim() : 'General';

            const steps = parseSteps(response);
            console.log('Parsed steps:', steps);

            if (steps.length === 0) {
                throw new Error('Failed to parse steps');
            }

            safeSetProblem({
                originalQuestion: userQuestion,
                steps,
                currentStepIndex: 0,
                currentUserInput: '',
                isCompleted: false,
                topic,
            });

            setMode('problem');
        } catch (error) {
            console.error('Error generating steps:', error);
            alert('Failed to generate problem steps. Make sure Ollama is running.');
        } finally {
            safeSetLoading(false);
        }
    };

    const verifyStepAnswer = async (appState: any, _setMode: any) => {
        if (!appState.problem || appState.problem.currentStepIndex >= appState.problem.steps.length) return;

        appState.setLoading(true);
        try {
            const currentStep = appState.problem.steps[appState.problem.currentStepIndex];
            let contextText = `Original Question: ${appState.problem.originalQuestion}\n\n`;

            for (let i = 0; i < appState.problem.currentStepIndex; i++) {
                const prevStep = appState.problem.steps[i];
                contextText += `Step ${i + 1}: ${prevStep.instruction}\nStudent's Answer: ${prevStep.userAnswer}\n\n`;
            }

            contextText += `Current Step ${appState.problem.currentStepIndex + 1} of ${appState.problem.steps.length}: ${currentStep.instruction}\nStudent's Answer: ${appState.problem.currentUserInput}`;

            const verifyPrompt = `Given the following problem context, verify if the student's answer for the current step is correct.

${contextText}

Respond EXACTLY in this format:
CORRECT: [yes or no]
EXPLANATION: [brief explanation of the correct answer]`;

            const response = await callOllamaModel(verifyPrompt);
            const lines = response.split('\n').filter((line: string) => line.trim());
            const correctLine = lines.find((line: string) => line.startsWith('CORRECT:'));
            const explanationLine = lines.find((line: string) => line.startsWith('EXPLANATION:'));

            const isCorrect =
                correctLine?.includes('yes') || correctLine?.includes('Yes') || correctLine?.includes('YES');
            const explanation = explanationLine?.replace('EXPLANATION:', '').trim() || '';

            const updatedSteps = [...appState.problem.steps];
            updatedSteps[appState.problem.currentStepIndex] = {
                ...currentStep,
                userAnswer: appState.problem.currentUserInput,
                isCorrect: isCorrect ?? null,
                correctAnswer: explanation,
            };

            if (isCorrect) {
                appState.setStepFeedback('✓ Correct! Moving to next step...');
                setTimeout(() => {
                    if (appState.problem!.currentStepIndex + 1 >= appState.problem!.steps.length) {
                        appState.setProblem({ ...appState.problem!, steps: updatedSteps, isCompleted: true });
                    } else {
                        appState.setProblem({
                            ...appState.problem!,
                            steps: updatedSteps,
                            currentStepIndex: appState.problem!.currentStepIndex + 1,
                            currentUserInput: '',
                        });
                        appState.setStepFeedback('');
                    }
                }, 1500);
            } else {
                appState.setStepFeedback(`✗ Not quite right. ${explanation ? `${explanation}` : 'Try again!'}`);
                appState.setProblem({ ...appState.problem, steps: updatedSteps });
            }
        } catch (error) {
            console.error('Error verifying step:', error);
            appState.setStepFeedback('Error verifying answer. Try again.');
        } finally {
            appState.setLoading(false);
        }
    };

    return { generateSteps, verifyStepAnswer };
}

function parseSteps(response: string): Step[] {
    const steps: Step[] = [];
    let stepNum = 1;

    while (true) {
        const stepPattern = `STEP${stepNum}:`;
        const answerPattern = `STEP${stepNum}_ANSWER:`;

        const stepIndex = response.indexOf(stepPattern);
        const answerIndex = response.indexOf(answerPattern);

        if (stepIndex === -1 || answerIndex === -1) break;

        const instructionStart = stepIndex + stepPattern.length;
        const instruction = response.substring(instructionStart, answerIndex).trim();

        const answerStart = answerIndex + answerPattern.length;
        const nextStepPattern = `STEP${stepNum + 1}:`;
        const nextStepIndex = response.indexOf(nextStepPattern, answerStart);
        const finalAnswerIndex = response.indexOf('FINAL_ANSWER:', answerStart);

        let answerEnd = response.length;
        if (nextStepIndex !== -1) answerEnd = Math.min(answerEnd, nextStepIndex);
        if (finalAnswerIndex !== -1) answerEnd = Math.min(answerEnd, finalAnswerIndex);

        const correctAnswer = response.substring(answerStart, answerEnd).trim();

        if (instruction && correctAnswer) {
            steps.push({
                number: stepNum,
                instruction,
                userAnswer: '',
                isCorrect: null,
                correctAnswer,
            });
        }

        stepNum++;
    }

    return steps;
}